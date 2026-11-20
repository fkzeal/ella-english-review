# 本地接手入口：Ella 英语复习站

本包是从云任务迁移到 Mac 本地项目的接手包。整理日期：2026-11-19。

## 本机已接手的位置

- 新课程发布（2026-11-20）：飞书文档修订45的10张图已核对，
  RAZ章鱼绘本10目标/21题、剑桥Rules15目标/32题，r7合计136题，
  隔离构建`74a158aaee17`，76项测试通过。用户已授权后续新素材自动建题发布；
  本次用户也明确批准首轮候选与Pad适配一并上线。
  入口为`课程素材自动建库.md`，私有去重账本`.course-imports/ledger.json`；
  首轮53题须待生产核验后标记published，后续自动任务不得重新导入。
  预览在工作区`Ella-新课程题目预览-2026-11-20/`；定时注册及执行状态查内置任务工具。
- Pad适配（2026-11-20）：0.4.11，Pad边距和大字号适配已完成，
  用户复核后阅读原文进一步加大至32–36px，保留1.8倍行距。
  76项测试与构建通过；Chrome、WebKit六种Pad横竖屏尺寸通过，Chrome手机/宽桌面回归通过。
- 上一发布（2026-11-20）：0.4.10，main `2c5cd7c`，构建摘要 `f83e93f3878f`。
  审查5项P1修复完成，76项测试、Actions `44685342799`及本地/线上Chrome回归通过。
  83题/r6、六猫、日期及存储键保持；详细证据见LOCAL_VERIFICATION。
  下述迁移与0.4.7核验部分为接手历史。
- 持续维护仓库：`/Users/Ivens/Documents/trae_projects/Vibe Coding/ella-english-review`。
- 复用已成功发布的原仓库，并迁入 Vibe Coding；保留完整 Git 历史与 origin。
  迁移前没有未提交改动；没有使用 bundle 再克隆，也没有重置、提交或推送。
- 原路径 `/Users/Ivens/Documents/Trae-CN/temp_20261119_01/ella-english-review`
  现为兼容符号链接，指向上述唯一仓库。
- Vibe Coding 根目录的 `AGENTS.md` 指向本接手入口，
  `.trae/environments/run.json` 保存本地启动命令。
- Node 22.23.5 已安装至 `$HOME/.local/share/node-v22.23.5-darwin-arm64`；
  执行 npm 前将其 `bin` 加到当前进程 PATH 最前。系统默认 Node 没有切换。
- 本地 GitHub CLI：`$HOME/.local/bin/gh`，配置在 `$HOME/.config/gh`，
  身份 `fkzeal`，凭据仍由 macOS 钥匙串管理。
- 首次核验结果和未解决事项见 `LOCAL_VERIFICATION.md`。

## 先读什么

1. 本文件：迁移、安装和验证。
2. `PROJECT_MEMORY.md`：用户要求、当前事实和未完成事项。
3. `CONVERSATION_DECISIONS.md`：按时间整理的对话决策。
4. `AGENTS.md`：题库和学习记录维护约定。
5. `复习策略与考点核查.md`、`两节RAZ课程-题库教研记录.md`。
6. 根据实际任务阅读代码、`audio/README.md` 和部署文件。

这是基于可见对话和项目文件编写的接手摘要，不是完整聊天原文导出。
历史文档含旧版本说明：以最新代码、本记忆文件和现场核验为准。
目录归属“Vibe Coding”只负责组织任务，不能自动复制云端目录或聊天记忆。

## 包结构

- `source/`：当前 main 提交的完整跟踪文件，包含代码、题库、音频、插画、测试、工作流。
- `ella-0.4.7.bundle`：完整 main 分支 Git 历史，可离线恢复仓库。
- 根目录四份接手文档（包括本文件和可直接粘贴的话术）。
- `preview/`：内嵌音频和猫咪图片的离线试玩 HTML，以及首页/手机/奖励截图。

包内没有 GitHub/Cloudflare Token，没有 node_modules，没有用户浏览器答题记录。
没有完整聊天原文或所有历史学习原图；不能声称这些已经迁移。

## 安装：优先复用已有本地仓库

用户已有一个成功发布 0.4.7 的本地任务。先查找它的仓库目录、当前分支、
remote 和未提交修改。若 main 已包含 `1f74906`，直接复用，不必重新导入 bundle。
不要重置分支、强推或覆盖已有修改。

若需要新目录：

```sh
git clone /实际下载解压路径/ella-0.4.7.bundle /用户选择路径/ella-english-review
cd /用户选择路径/ella-english-review
git remote set-url origin https://github.com/fkzeal/ella-english-review.git
```

将根目录的 `MIGRATION_START_HERE.md`、`PROJECT_MEMORY.md`、
`CONVERSATION_DECISIONS.md` 和 `本地任务接手话术.md` 复制到本地仓库，
之后持续更新记忆。首次初始化无需提交或发布这些文档。
`source/` 用于直接查看或没有 Git 时恢复源码；不要用它覆盖不同版本的仓库。

## 本地验证

使用 Node.js 22（与 Actions 一致）。`npm ci` 安装锁定依赖。

```sh
npm ci
npm test
npm run build
npm start
```

`server.js` 服务 `dist/`，改源码后需要重新构建。默认本地 URL：
`http://localhost:4173/`。占用时用 `REVIEW_PORT=4174 npm start` 等未占用端口。
保留用户已有服务，不按端口盲目杀进程。

验证：首页猫咪、开始练习、正确奖励、不同猫咪轮换、错题反馈、
听力正常/慢速/停止、手机布局和家长课程日期入口。
浏览器视觉验证工具按本地任务实际可用能力使用；原云端 `/tmp` 工具没有打包。

## 发布与凭据

生产网址：https://ella-english-review.pages.dev/
仓库：https://github.com/fkzeal/ella-english-review
分支：main；最新已核验生产提交：`2c5cd7cf13ec0e042540537bdb0e9723f10e99ed`。
本地任务已核验远端main和线上 `version.js` 为0.4.10，摘要 `f83e93f3878f`。
此前0.4.7迁移基线提交为 `1f74906`，摘要为 `783b1725451c`。

通常本地检查后提交、推送 main，`.github/workflows/deploy.yml` 在 GitHub 上
安装依赖、测试、构建、部署到既有 Cloudflare Pages。本地不需要 Cloudflare Token。
若手工执行 `npm run deploy`，则需另有 Cloudflare 凭据；不要默认走这条路径。

本地 GitHub 登录与云端插件授权不是同一回事。先检测当前本地身份与仓库权限。
如缺认证，使用本地宿主提供的正规授权流程，由用户在安全界面完成，
不要求在聊天中粘贴 Token，不把凭据写进仓库或交接包。
原云任务反复授权仍没有 `GH_TOKEN`，不能把插件“授权成功”当推送成功。

本机 2026-11-19 已验证仓库读取、ADMIN 权限和模拟推送。
原始终端 Git 没有直接复用 gh 身份，本次不更改全局或仓库 Git 配置；
需要调用钥匙串身份时使用仅作用于当前命令的 helper：

```sh
GIT_TERMINAL_PROMPT=0 git -c credential.helper= \
  -c 'credential.helper=!/Users/Ivens/.local/bin/gh auth git-credential' \
  push --dry-run --porcelain origin main:main
```

上述命令只模拟推送。未来真实发布仍须用户明确授权。

首次接手只核验现有线上版本，不发布新的内容；之后按用户的发布指令执行。
发布必须确认对应提交的 Actions 成功，以及原网址版本/题库/图片实际可用。

## 学习记录

实际学习记录在各设备原站点 localStorage，不在 Git 或本包内。
稳定键为 `lesson-loop-data-v1`，不可更名或清空。
本地预览、file:// 和生产域名属于不同存储范围，不能自动共享进度。
需用网站家长入口导出/恢复；迁移开发环境本身不要求清除线上记录。
