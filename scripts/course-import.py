"""Private Feishu material inventory and validated bank merge.

Question authoring remains in the agent's image-reading workflow, outside the
website. This script never commits, pushes, publishes, or marks data published.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
DOCUMENT = "https://dcar.feishu.cn/docx/RhNgdppuWoKp6kxjE24cOwjfnwh"


def load(path):
    return json.loads(Path(path).read_text())


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def document_data(response):
    if not isinstance(response, dict) or response.get("ok") is not True:
        raise ValueError("飞书读取没有返回ok:true；保留旧账本，不标记已处理")
    doc = response.get("data", {}).get("document")
    if not isinstance(doc, dict) or not isinstance(doc.get("content"), str):
        raise ValueError("缺少完整document.content，不能按空文档处理")
    if doc.get("document_id") != DOCUMENT.rsplit("/", 1)[-1]:
        raise ValueError("返回的文档编号与固定素材来源不一致")
    xml = ET.fromstring("<document>" + doc["content"] + "</document>")
    title = ""
    headings = []
    images = []
    for el in xml.iter():
        if el.tag == "title":
            title = "".join(el.itertext())
        if el.tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            headings.append("".join(el.itertext()))
        if el.tag == "img":
            token = el.get("src") or el.get("token")
            block = el.get("id")
            if not token or not block:
                raise ValueError("图片缺少素材token或blockId，停止扫描")
            images.append({"fileToken": token, "blockId": block,
                           "name": el.get("name", ""), "heading": headings[-1] if headings else ""})
    return {"documentUrl": DOCUMENT, "documentId": doc["document_id"],
            "revision": doc.get("revision_id"), "title": title,
            "headings": headings, "images": images}


def scan(args):
    state = args.state.resolve()
    state.mkdir(parents=True, exist_ok=True)
    with (state / "inventory.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = load(state / "ledger.json") if (state / "ledger.json").exists() else {
            "version": 1, "documentUrl": DOCUMENT, "media": {}, "runs": []}
        if ledger.get("version") != 1 or ledger.get("documentUrl") != DOCUMENT or not isinstance(ledger.get("media"), dict):
            raise ValueError("私有账本来源或结构无效；不能重置已有状态")
        if args.snapshot:
            response = load(args.snapshot)
        else:
            result = subprocess.run(
                ["lark-cli", "docs", "+fetch", "--doc", DOCUMENT,
                 "--scope", "full", "--detail", "full", "--doc-format", "xml"],
                capture_output=True, text=True, timeout=120)
            (state / "fetch.stdout.json").write_text(result.stdout)
            (state / "fetch.stderr.log").write_text(result.stderr)
            result.check_returncode()
            response = json.loads(result.stdout)
        inventory = document_data(response)
        known = ledger["media"]
        pending = []
        duplicates = []
        seen = set()
        for image in inventory["images"]:
            token = image["fileToken"]
            if token in seen:
                duplicates.append({**image, "reason": "same-file-token-in-document"})
                continue
            seen.add(token)
            if token in known:
                continue
            pending.append(dict(image))
        if args.download:
            dest = state / "media"
            dest.mkdir(exist_ok=True)
            for image in pending:
                stem = hashlib.sha256(image["fileToken"].encode()).hexdigest()[:24]
                files = list(dest.glob(stem + ".*"))
                if not files:
                    result = subprocess.run(
                        ["lark-cli", "docs", "+media-preview", "--token", image["fileToken"],
                         "--output", "./" + stem],
                        cwd=dest, capture_output=True, text=True, timeout=120)
                    (state / f"{stem}.preview.stdout.json").write_text(result.stdout)
                    (state / f"{stem}.preview.stderr.log").write_text(result.stderr)
                    result.check_returncode()
                    download = json.loads(result.stdout)
                    if download.get("ok") is not True:
                        raise ValueError(f"图片预览失败：{image['blockId']}")
                    files = list(dest.glob(stem + ".*"))
                if len(files) != 1 or files[0].stat().st_size == 0:
                    raise ValueError(f"图片下载没有唯一且非空的结果：{image['blockId']}")
                image["localPath"] = str(files[0])
                image["sha256"] = hashlib.sha256(files[0].read_bytes()).hexdigest()
            hashes = {m["sha256"]: token for token, m in known.items() if m.get("sha256")}
            unique = []
            for image in pending:
                digest = image["sha256"]
                if digest in hashes:
                    duplicates.append({**image, "reason": "same-image-bytes",
                                       "canonicalFileToken": hashes[digest]})
                else:
                    hashes[digest] = image["fileToken"]
                    unique.append(image)
            pending = unique
        inventory["newImages"] = pending
        inventory["duplicateImages"] = duplicates
        inventory["heldLessonIds"] = sorted({
            m["lessonId"] for m in known.values()
            if m.get("status") == "pending-review" and m.get("lessonId")})
        inventory["knownImages"] = sum(token in known for token in seen)
        inventory["unresolvedImages"] = [
            {"fileToken": token, **m} for token, m in known.items()
            if m.get("status") in ["needs-material", "pending-integration", "staged", "pushed"]]
        inventory["note"] = "扫描全量未处理素材，包含晚到/补图；归档标题不是确认学习日。扫描不改变发布状态。"
        atomic_json(state / "scan.json", inventory)
        print(json.dumps({"output": str(state / "scan.json"), "revision": inventory["revision"],
                          "images": len(inventory["images"]), "newImages": len(pending),
                          "duplicateImages": len(duplicates),
                          "heldLessonIds": inventory["heldLessonIds"]}, ensure_ascii=False))


def merge(args):
    base_path = args.base.resolve()
    engine = base_path.parent / "engine.js"
    if not engine.is_file():
        engine = ROOT / "engine.js"
    node = shutil.which("node")
    saved = Path.home() / ".local/share/node-v22.23.5-darwin-arm64/bin/node"
    if saved.is_file():
        node = str(saved)
    if not node:
        raise ValueError("缺少Node运行时")
    script = """
const fs=require('fs'), E=require(process.argv[1]);
const base=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const patch=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
if(patch.mode!=='patch')throw Error('仅接受mode=patch候选包');
patch.revision=(base.revision||1)+1;
const merged=E.mergeBank(base,patch); merged.mode='snapshot'; E.validateBank(merged);
fs.writeFileSync(process.argv[4],JSON.stringify(merged,null,2)+'\\n');
console.log(JSON.stringify({revision:merged.revision,questions:merged.questions.length,newQuestions:merged.questions.length-base.questions.length}));
"""
    if args.output.resolve() == ROOT / "question-bank.json" and not args.write_source:
        raise ValueError("默认禁止改主工作区题库；向临时发布工作树写入或显式使用--write-source")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="validated-bank-", dir=args.output.parent)
    os.close(fd)
    try:
        result = subprocess.run([node, "-e", script, str(engine), str(base_path),
                                 str(args.patch.resolve()), name],
                                text=True, capture_output=True, check=True)
        os.replace(name, args.output)
        print(result.stdout.strip())
    finally:
        if os.path.exists(name):
            os.unlink(name)


parser = argparse.ArgumentParser(description=__doc__)
sub = parser.add_subparsers(dest="command", required=True)
s = sub.add_parser("scan", help="Inventory all unseen course images, without acknowledging them")
s.add_argument("--state", type=Path, default=ROOT / ".course-imports")
s.add_argument("--snapshot", type=Path, help="Use an already fetched response for offline verification")
s.add_argument("--download", action="store_true", help="Preview new media locally and compare byte hashes")
s.set_defaults(run=scan)
m = sub.add_parser("merge", help="Validate a candidate patch against a bank without publishing")
m.add_argument("--base", type=Path, required=True)
m.add_argument("--patch", type=Path, required=True)
m.add_argument("--output", type=Path, required=True)
m.add_argument("--write-source", action="store_true")
m.set_defaults(run=merge)
args = parser.parse_args()
args.run(args)
