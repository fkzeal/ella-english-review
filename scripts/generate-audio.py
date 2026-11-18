"""Pre-generate listening clips; never run speech inference in the child's browser.

Requires Python 3.11+, kokoro-onnx==0.4.9, ffmpeg, Kokoro v1.0 ONNX and
voices-v1.0.bin. Models stay outside the repository. See audio/README.md.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import wave

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--voices", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / "audio"
out.mkdir(exist_ok=True)
bank = json.loads((root / "question-bank.json").read_text())
demo = "Hello! Let us review English together. I always go swimming on Tuesdays."
texts = list(dict.fromkeys([q["audioText"] for q in bank["questions"]
                          if q.get("active", True) and q["type"] == "listening"] + [demo]))
config = {"engine": "Kokoro-82M-v1.0-int8", "voice": "bf_emma",
          "language": "en-gb", "speed": 0.9, "sentenceGapSeconds": 0.35}
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(args.model, options, providers=["CPUExecutionProvider"])
tts = Kokoro.from_session(session, args.voices)
manifest = {"config": config, "demoText": demo, "clips": {}}
with tempfile.TemporaryDirectory(prefix="ella-audio-") as tmp:
    for text in texts:
        digest = hashlib.sha256((json.dumps(config, sort_keys=True) + text).encode()).hexdigest()[:24]
        name = digest + ".mp3"
        dest = out / name
        if not dest.exists():
            chunks = []
            # Preserve words, contractions and sentence intonation; add breathing
            # room between complete sentences, never pause between every word.
            sentences = re.split(r"(?<=[.!?])\s+", text.strip())
            for i, sentence in enumerate(sentences):
                samples, sample_rate = tts.create(sentence, voice=config["voice"],
                                                  speed=config["speed"], lang=config["language"])
                if not len(samples) or not np.isfinite(samples).all():
                    raise RuntimeError("Invalid generated audio")
                if i:
                    chunks.append(np.zeros(int(sample_rate * config["sentenceGapSeconds"]), dtype=np.float32))
                chunks.append(samples)
            samples = np.concatenate(chunks)
            wav = str(Path(tmp) / "clip.wav")
            with wave.open(wav, "wb") as fp:
                fp.setnchannels(1)
                fp.setsampwidth(2)
                fp.setframerate(sample_rate)
                fp.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav,
                            "-af", "loudnorm=I=-18:TP=-2:LRA=7", "-ar", "24000",
                            "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k",
                            str(dest)], check=True)
        duration = float(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(dest)]))
        if duration < 0.3 or duration > 60:
            raise RuntimeError(f"Unexpected clip duration: {name}")
        manifest["clips"][text] = {"file": "audio/" + name, "duration": round(duration, 3),
                                  "sha256": hashlib.sha256(dest.read_bytes()).hexdigest()}
        print(f"Ready {len(manifest['clips'])}/{len(texts)}: {text}", flush=True)
(out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
