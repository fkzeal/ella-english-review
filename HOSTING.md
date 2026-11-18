# 固定托管配置：Cloudflare Pages

本项目采用 Cloudflare Pages 静态托管，使用固定项目名 `ella-english-review`；默认平台域名与 HTTPS 不依赖当前开发环境或隧道进程。项目名如已被占用，需要首次创建前调整配置；不能在每次更新时改项目名。

## 当前状态

用户已上传 `/workspace/英语复习小站-0.4.1-含验证文件.zip` 并完成生产部署。2026-11-18 通过线上 HTTP 验证：`version.js` 返回 **0.4.1 / 题库 r4 / 构建 a43501a8d867**；根目录 `99e0d85e952f8d812c763271f7a246d3.txt` 返回 HTTP 200、text/plain，正文为 `5ec0a397ebe9ad8108a3c463a5ba1bf33986806f`。外部申请的最终校验结果需在申请页面提交后确认。

2026-11-18 本地验证：39 项自动化测试通过；浏览器完成实际作答保存、听力提示 → 暂停 → 刷新 → 续答仍记为提示、次日复习安排、结束练习后迁移到题库 r4、家长版本显示和 23 项分项进度。预览环境缺少 Web Locks，已实际验证 IndexedDB 事务锁兼容路径能保存。浏览器控制台无应用错误。此验证不代表线上已更新。

Cloudflare 项目 `ella-english-review` 已于 2026-11-18 在用户账号中创建，并由用户完成首次 ZIP 上传部署。固定生产网址已上线：https://ella-english-review.pages.dev/

项目控制台：https://dash.cloudflare.com/5632b9865dfee869521889b971476d72/pages/view/ella-english-review

浏览器账号已登录，但 Wrangler 的 OAuth 回调未成功完成，因此 CLI 尚未取得发布凭据。工具浏览器与工作区文件系统分离，自动上传 ZIP 失败。用户已在自己的控制台上传 `/workspace/英语复习小站-Cloudflare上传.zip` 并完成发布。该包只含 dist 静态文件，不含账号或授权资料。

后续可在同一项目上传新包，生产域名保持不变；`npm run deploy` 需要先完成 Wrangler 授权。不得声称当前 CLI 已授权或可无人值守发布。

## 免手动 ZIP 的自动发布

目标 GitHub 私有仓库：https://github.com/fkzeal/ella-english-review 。已授权工作区以 fkzeal 推送源码，已配置仓库 Secret `CLOUDFLARE_ACCOUNT_ID`。发布 Token `CLOUDFLARE_API_TOKEN` 尚未配置。源码位于仓库根目录，发布分支 main；生成的 dist、bank.js 和 version.js 由工作流构建，不提交。须以首次 Actions 成功运行及线上版本核对为验收依据。

已提供 `.github/workflows/deploy.yml`。推送 main 或手动运行会触发工作流；若缺少任一 Cloudflare Secret，会在部署前明确报错，避免启动交互登录。当前还需添加发布 Token，不能声称已完成自动部署。

推荐在 GitHub 私有仓库根目录放本项目源码，在仓库 Settings → Secrets and variables → Actions 配置两个 Secret：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token，给予对应账号的 Cloudflare Pages 编辑权限。使用自定义 Token，不使用账号 Global API Key。
- `CLOUDFLARE_ACCOUNT_ID`：本项目的 Cloudflare 账号 ID。

Token 通过 Cloudflare 控制台创建并直接粘贴到 GitHub Secret，不发在聊天、不提交源码。工作流只读取 Secret，在推送 main 后自动测试、构建并发布当前 Direct Upload Pages 项目，生产域名保持不变。不需要把现有项目转换为 Pages 原生 Git 集成。

一次配置完成后，后续题库更新提交到 main 即可发布。当前只缺发布 Token；添加后可在仓库 Actions 页面手动运行工作流，无需再次上传 ZIP。

2026-11-18 已在固定网址通过浏览器验证：主页加载、题库和 app.js/engine.js 返回 200、开始练习、显示选择题、选答案后立即反馈及出现下一题按钮。上线内容为 43 道 My week 原创题，学习批次为空。命令行 urllib 的访问返回 403，浏览器访问与实际作答正常；不能据此宣称所有网络环境均已验证。

## 首次部署

建议使用 Node.js 22 或以上，在项目目录执行：

```sh
npm ci
npm run hosting:login
```

在 Cloudflare 官方授权页登录自己的账号并授权部署。账号登录或验证码需要用户本人完成，不在代码中保存密码、API 密钥或会话令牌。

登录后创建一次项目：

```sh
npm run hosting:create
npm run deploy
```

若已有同名项目，不重复创建，确认是本应用后直接 deploy。创建时生产分支固定为 main。部署成功后记录平台返回的生产域名，验证主页、question-bank.json 和实际答题流程，再分享给家长。不要把某次部署预览地址当作长期入口。

授权回调使用 Cloudflare 为 Wrangler 注册的 localhost:8976。远程浏览器回调必须能到达同一运行环境；如果登录后的回调页面打不开，保留该页面并交回浏览器处理，不自行重复申请新的授权。

## 每次题库更新

1. 在 TRAE 对话中更新正文核对结果、考点、题目及实际学习批次。
2. 执行 `npm run deploy`。
3. 脚本自动运行测试、构建并发布到相同项目的 main 生产分支。
4. 检查固定生产地址的题库版本。妈妈继续使用同一网址，本地答题记录保留。

不购买服务器，不要求绑定自定义域名，也不添加收费数据库或模型 API。套餐和额度以本人 Cloudflare 控制台当前显示为准，未经用户同意不开通付费服务。

## 环境与记录

该部署只是页面和题库托管；学习记录仍在使用设备浏览器中。首次从临时域名迁移到固定域名前，先导出完整备份，再在固定域名恢复。以后不变更域名，更新题库不会创建新的浏览器记录空间。

Cloudflare 授权资料由工具保存在项目外或忽略目录中；分享源码只包含项目文件，排除 node_modules、.wrangler 和所有 .env 文件。环境重新创建后可能需要重新授权；线上已发布站点仍继续提供最后一次成功发布的版本。
