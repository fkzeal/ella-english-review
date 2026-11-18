# 当前固定公网入口

长期项目：`ella-english-review`，固定网址 https://ella-english-review.pages.dev/ 已上线。用户上传完成后，2026-11-18 已用外部浏览器验证页面、题库和实际作答反馈正常。该站点由 Cloudflare Pages 提供，不依赖开发环境或临时隧道继续运行。后续在同一项目创建生产部署即可保持网址不变。当前实际状态与更新步骤见 HOSTING.md。

0.4.1 已由用户上传 `/workspace/英语复习小站-0.4.1-含验证文件.zip` 并完成生产发布。2026-11-18 线上 `version.js` 验证应用 0.4.1、题库 r4、构建 a43501a8d867，TXT 验证文件返回 HTTP 200 且正文正确。本地 41 项测试通过。自动发布工作流已准备，尚未配置 GitHub 仓库与发布 Secret。

## 历史临时测试入口

测试地址：https://washington-ordinance-matthew-forestry.trycloudflare.com/

这是 Cloudflare Quick Tunnel 提供的临时 HTTPS 公网入口，连接本项目的 4180 端口静态服务。2026-11-18 已通过外部 HTTP 及浏览器验证：主页和题库返回 200，开始练习、选择答案和即时反馈正常。

当前测试使用 43 道 My week 题目，没有伪造学习日期或 Country Places 正文。更新 question-bank.json 后执行 npm run build，运行中的静态服务会提供新的 dist 内容；无需更改当前测试网址。

此入口依赖当前运行环境、静态服务与隧道进程。停止或重建隧道后地址可能失效或改变，不承诺持续可用。长期使用需要固定托管或命名隧道。换域名测试前请导出学习记录备份。

启动静态服务：

```sh
REVIEW_PORT=4180 npm start
```

本次使用从 Cloudflare 官方 GitHub release 下载的 cloudflared 二进制：

```sh
/tmp/review-deploy/cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:4180
```

该命令重新执行会创建新地址，不能拿本文件中的旧地址当作当前存活证据。每次必须从隧道启动输出读取新地址并验证主页、题库和实际答题。
