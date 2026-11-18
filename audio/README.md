# 听力音频维护

当前15道听力题与1条试听稿均使用预生成的英式合成女声（Kokoro bf_emma），不是真人录音。保留题库 audioText 原文；合成速度0.9、完整句子之间额外留350ms停顿，响度规范化至约-18 LUFS、峰值上限-2 dBTP。网页“慢速听”以0.82倍播放并保持音调。

浏览器直接播放本站 MP3，正常播放不调用语音接口，也不依赖设备安装的音色。音频异常或旧的本地题目没有匹配录音时，才尝试设备英文声音，并明确显示备用状态；无英文声音时保留家长读题入口。

## 新增听力题

先修改 question-bank.json，再为新增 audioText 生成音频。原题文本相同时复用音频。改变文本或生成配置时文件名随内容摘要改变，避免缓存播错。manifest.json 按完整原文匹配并记录文件SHA-256。构建检查全部有效听力题及试听稿；缺失或损坏直接失败，不发布缺音频的新版。

生成环境需 Python 3.11+、kokoro-onnx（本轮版本见下方）、ffmpeg；不加入网站运行依赖。模型和临时文件放在仓库之外，不能提交。

模型来源：
- https://github.com/thewh1teagle/kokoro-onnx
- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
- 上游模型：https://huggingface.co/hexgrad/Kokoro-82M（Apache-2.0）。

```sh
python -m pip install kokoro-onnx==0.4.9
python scripts/generate-audio.py --model /outside-repo/kokoro-v1.0.int8.onnx --voices /outside-repo/voices-v1.0.bin
npm test
npm run build
```

提交 audio/manifest.json 与生成的 MP3。GitHub Actions 只校验、复制这些静态音频，不下载模型或实时生成。
独立 HTML 构建会内嵌音频，以便下载后使用；公网版本使用可缓存的独立 MP3。

验证范围：生成稿与题目原文一致、音频格式／时长／可解码性、播放控制与备用路径。自动检查不能替代实际听感评价；可在家长题库试听后反馈具体不清楚的单词。
