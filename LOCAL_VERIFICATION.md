# 本地迁移核验记录

## 适配与复习调度核验（2026-11-21，仅本地）

发布候选0.5.0/r9/149题；最终构建、提交、生产Actions与线上核验待本轮记录。
测试仅隔离浏览器上下文，未修改用户真实学习记录。
原1400→1401px两侧30.8→320.5px、问题34→25px已复现；
扩展断点后701–2560px两侧20–32px、问题32–34/选项24–26px。
Chrome/WebKit各11种答题宽度和7种首页尺寸，共36布局项通过；
开练/续练首屏可见、欢迎/奖励两列、手机上下、无横向溢出。
Chrome/WebKit均实测beet独立正确总数114→113、nextDue=11月24日、
26宽泛组仍到期、自动候选不再含beet；阅读1440px正文36px、125% CSS缩放无溢出。
跨日首页0→1、日期更新、保存原文不变；新增回归同时保留答题/解析/结算显示。
94项Node22回归全通过，149题/100猫构建成功。之前新增回归在旧代码失败日志保留。
无历史r9在11月21日为114分项/26组，不是用户截图25组的实际数据。
自用浏览器无可操作标签，桌面SDK两次状态错误；未读取真实记录、未重置或导入测试历史。
未验证实体Pad；具体25组来源需对应浏览器「导出完整备份」后再逐项对账。
报告记录修复前P1断点/P2跨日两项，已本地修复；调度本身未发现已证实缺陷。
完整说明和报告在工作区`Ella-复习调度与适配核验-2026-11-21/`，
日志/快照/机器结果/截图在`/tmp/ella-revisit-20261121/`。

## 猫咪激励系统本地验证（2026-11-20，未发布）

当时本地 `0.5.0-preview.3`，线上保持0.4.14/r9/149题；HEAD仍341cf2d。
当时本地构建 `bacbd9bbba70`，2026-11-20T15:53:11.586Z；最新见上节。
本轮没有提交、推送、部署或读写生产用户进度。复用本仓库4173预览服务。
试玩 http://localhost:4173/?preview=cats 使用独立演示数据，正常练习在根路径。

91项Node22测试通过，149题/100猫/300图构建成功，100原图与ZIP逐字节一致。
Chrome820px真实三组全对、刷新幂等、双击仅开一次、猫收藏飞入、100格剪影/
已开图鉴、放大/筛选/刷新保存，8/10与12/15半星、7/10不发星均通过。
Chrome320/390/1180/1440px图鉴/结算/放大无横向溢出。
WebKit及Chrome减少动画模式完整三组到收藏通过，无pageerror。
本地演示隔离正常记录、开箱余额溢出、方向键浏览、离线1024px内嵌图通过。
收藏动画结束前视图改变时拒绝旧导航回调；未验证实体Pad。细则见`猫咪激励系统.md`。
测试日志 `/tmp/ella-cat-unit-tests.log`、`/tmp/ella-cat-browser-tests.log`、
`/tmp/ella-cat-preview-tests.log`，截图和机器结果 `/tmp/ella-cats-qa/`。

preview.2题目栏/原文默认状态：91测试通过，Chrome320/390/820/1180px、
WebKit820px共25次作答涵盖Rules四题型与RAZ长标题。
题型/课程/反馈中心在同一行，考点名称不展示，页面无横向溢出；
答错默认展开/答对默认收起/手动开关/下一题新状态/继续按钮可见/5条历史保存均通过。
浏览器无pageerror，测试使用隔离上下文，不改用户生产进度。
日志`/tmp/ella-question-layout-tests.log`、`/tmp/ella-question-layout-browser.log`，
截图与结果`/tmp/ella-question-layout-qa/`。

preview.3首页两列/首屏/结算题数：91项回归通过。Chrome8种尺寸（320/390手机、
768/820竖屏、1024/1180横屏、1440桌面、844×390低横屏）与WebKit2种Pad尺寸，
开练/续练按钮在首屏可见，欢迎、星星、宝箱及反馈导航正常，无横向溢出或按钮裁切。
初验低横屏开练下沿394px/续练396px超出390px，收紧短屏及续练说明后
最终下沿374.8px/372.5px；未为容纳首页缩小题目/原文/选项字号。
6/10/15/20/7/19题共12组结算上下边界显示向上取整门槛5/8/12/16/6/16，
没有百分比文案，半星成功显示实际答对数；首页已满三星开箱到图鉴通过。
未读写用户生产记录，所有检查使用隔离上下文，未提交、推送或发布。
日志`/tmp/ella-home-layout-tests.log`、初验`/tmp/ella-home-layout-browser.log`、
最终剩余检查`/tmp/ella-home-layout-browser-remaining-2.log`，截图`/tmp/ella-home-layout-qa/`。

## 0.4.14错误反馈与发布（2026-11-20）

- 题目右上角新增44px高“反馈错误”，带当前题号/课程/题干选项答案解析/
  听读素材/应用与题库版本/唯一反馈ID。答后会话游标已推进时仍指向刚展示的题。
- 真匿名浏览器从按钮打开飞书表单并提交，授权CLI从Base读回；三条QA记录保留，
  状态均“验证记录”，待核查0条。第三条实测输入说明
  `QA validation only, no real question error.`并成功回读；前两次自动化中文键盘
  输入编辑器未持久化，后续用完整键盘事件和编辑等待验证，不冒称两次说明写入成功。
- 全量NDJSON读取、空库/非空库解析、状态写入并回读通过。发布回写需Actions和
  固定生产题库回执；合成修复候选验证原地答案修改拒绝、日期移动拒绝、
  新题沿用旧reviewUnit拒绝、旧题删除拒绝、历史完全保留、新单项stage0当日到期。
  本轮无真实错误反馈，不用QA改实际题库，不声称无人值守修复已执行。
- Node22下80项测试通过；149题及27条完整音频资产构建通过。
  构建只导出公开formUrl，不含Base字段、反馈详情、原图或私有缓存。
- 本地Chrome320/390/820/1180/1366px，旧题和最新章鱼q34的新题，
  打开表单不改保存数据、预填题号版本准确、答后仍反馈原题、切题后切换新题；
  无横向溢出、按钮至少44px、无pageerror。单文件构建包含反馈脚本和配置。
- 基于origin/main的同仓库worktree发布，保留并行补页任务的r9/149题与新音频，
  不复制主工作区旧r8题库。提交`aa73478f6b66a9897d94a1998cf8cdc9cf09a7de`；
  [Actions44757144872](https://github.com/fkzeal/ella-english-review/actions/runs/44757144872)
  completed/success。
- 原网址实测0.4.14/r9/`f6bc2d514680`，
  builtAt=`2026-11-20T14:49:37.122Z`。生产Chrome五宽度、按钮打开匿名表单、
  最新题号/r9/0.4.14预填、答后/切题指向与1条合成练习历史保存均通过。
  所有浏览器使用隔离上下文，不读写用户既有生产进度。
- 本地main已快进至相同提交并重新构建；六份入口/核验记忆仍未提交。
  已发布17文件的专用stash保留备份，不需要pop；.DS_Store与旧本地接手话术保持。
- 维护脚本生产默认Python请求返回403；显式User-Agent后200，Actions+生产完整
  题目回执核查实测通过。另测无--receipt请求已修复被拒绝，三条QA仍验证记录。
  生产app/index/feedback helper/config/题库/音频清单6文件逐字节与发布dist一致。
  HTTP修正单独提交`341cf2d26a596e81e59864d09e29d9615a071b45`并正常推送；
  证据`/tmp/ella-feedback-final-check.log`、`/tmp/ella-feedback-production-receipt-probe/`。
  维护提交[Actions44758021058](https://github.com/fkzeal/ella-english-review/actions/runs/44758021058)
  completed/success；生产仍0.4.14/r9/f6bc2d514680，
  最新builtAt=`2026-11-20T14:55:01.777Z`。
- 原22:30任务增加反馈先核查，再处理新图；保存配置与未来无人值守运行分开记录。
  证据：`/tmp/ella-feedback-{e2e,release-browser,production-browser,release-tests,actions}.log`，
  共享读取与状态回执在私有`.error-feedback/`。完整流程在`错误题反馈与修复.md`。

## 0.4.13参考原文与发布（2026-11-20）

- 全136题添加references，21项完整原句逐字匹配已保存的章鱼素材核对JSON；
  其他为103项已核对词句、12项语法核对记录、41项原创阅读/听辨材料。无缺引用的有效题。
- 旧题所有身份字段、答案/选项、复习单项和课程目标/生成日不变；r7历史与进行中会话
  合并r8后完全保持，重复更新幂等，null/空数组/非法kind/空文本引用拒绝。
- 76项Node22回归、136题构建、完整音频覆盖通过；无新音频或源图片加入构建。
- 本地Chrome4尺寸、WebKit2尺寸，共96次答对/错，逐项核对展开文本与source、
  原创/核对记录标签、26px Pad引用文字、收起继续按钮、切题引用清除及保存，无溢出或脚本错误。
- 提交`aec8df52989f412a305244dab35776d3987ed591`，Actions
  [44753568021](https://github.com/fkzeal/ella-english-review/actions/runs/44753568021) success。
  原网址0.4.13/r8/`075192e66cc8`，builtAt=`2026-11-20T14:27:24.937Z`。
- 生产Chrome390×844、1180×820共16次正确/错误引用检查通过，源句、原创材料、
  素材要点标签及继续按钮可用。证据`/tmp/ella-references-qa/`、`/tmp/ella-references-*.log`。
  页面使用隔离浏览器上下文，未访问用户既有进度；生产补记留本地，不再次部署文档。

## 0.4.12答题后定位与发布（2026-11-20）

- 原0.4.11手机390×844/Pad820×1180答对答错共4次，解析可见而下一题4/4不可见。
- 新版按visualViewport/innerHeight及24px以内余量定位选项至继续按钮；
  内容过高时底部对齐，保留大字；正常模式平滑、减少动画立即定位。
- Node22下76/76回归和136题构建通过。Chrome6尺寸与WebKit3尺寸共72次
  选择/填空/阅读/听力答对答错，解析及继续按钮72/72可见、选项60/72全部可见；
  高度不足的12次优先解析/按钮，无横向溢出；实际点击切题、结果页、保存均正常。
- Chrome/WebKit减少动画立即滚动检查通过。截图、指标在
  `/tmp/ella-answer-scroll-qa/{before,after}/`，脚本`/tmp/ella-answer-scroll-qa.py`。
- 发布提交`2107e608b087688cd22e85fb2beeeb3d0fb976a3`，Actions
  [44751520311](https://github.com/fkzeal/ella-english-review/actions/runs/44751520311) success。
  原网址0.4.12/r7/`2d7267f42d6e`，builtAt=`2026-11-20T14:14:35.841Z`。
- 生产Chrome390×844、1180×820的16次四题型答对/错，选项、解析与继续按钮均可见；
  下一题/最终结果按钮/结果页定位、持久化正确及减少动画通过。页面无脚本错误。
  生产证据在`/tmp/ella-answer-scroll-qa/production/`。所有浏览器使用独立上下文。
- 产品提交只含app.js、package及锁版本和CHANGELOG；发布后核验补记保留本地，
  没有再次提交/部署文档；题库、音频、学习记录结构未改。

## 0.4.11 题库 r7 与 Pad 发布前核验（2026-11-20）

- 用户明确要求将题库更新和页面适配一并发布。r7在原83题基础新增53题：
  章鱼绘本10目标/21题，Rules15目标/32题，合计136题；其中新增8条bf_emma
  英式MP3，当前23条听力录音均有摘要校验和可用文件。
- Node22下76/76测试通过；构建验证136题、音频和离线嵌入均成功。
  题库结构、目标精确覆盖、已发布题身份、重复导入及缺音频拒绝均通过。
- 真实Chrome隔离上下文核验820×1180和1180×820，WebKit隔离上下文核验820×1180：
  家长题库显示0.4.11/r7/136题及两门新增课；章鱼课连续练习覆盖阅读和听力，
  正确反馈、翻题和结果页正常。Pad阅读正文至少32px、无横向溢出。
  Chrome 820px下慢速播放新听力、停止和默认隐藏听力文本均正常；页面无脚本错误。
- 提交`a5fa6b69f9fafdc64d580ae47f4c66ae4821c353`已推送main；
  [Actions 44748827997](https://github.com/fkzeal/ella-english-review/actions/runs/44748827997)
  success。原网址实际为0.4.11/r7/`b7a3e1acb8f2`，builtAt
  `2026-11-20T13:57:17.502Z`；Chrome生产隔离上下文显示136题和两门新课，
  实练章鱼课的选择、填空、阅读、听力均成功，新MP3返回`audio/mpeg`，
  820px内容宽度等于视口且无页面错误。

## 0.4.11阅读原文再放大（2026-11-20，未发布）

- 用户复核首轮原文仍偏小，Pad原文26–28px→32–36px，1.8行高。
  0.4.11/r6/`d792307ec825`，Node22下76/76测试通过，83题构建成功。
- Chrome/WebKit各复测六种Pad横竖屏尺寸，最长真实阅读短文自然换行、文字完整、
  无横向溢出；实际答题保存正确。820px为32px，1180/1366px为36px。
- 最新脚本与证据`/tmp/ella-pad-passage-qa.py`、`/tmp/ella-pad-passage-qa/`，
  完整测试/构建日志`/tmp/ella-pad-passage-{tests,build}.log`。
  新版截图为工作区`Ella-Pad适配预览-0.4.11/`内的`*原文加大版.png`。
  本地预览已更新；未提交、推送或发布，线上仍为0.4.10。

## 0.4.11首轮Pad适配本地预览（2026-11-20，未发布）

- 本地0.4.11/r6/`c9287f6e0891`；Node22下76/76测试通过，83题构建与媒体校验通过。
  完整日志`/tmp/ella-pad-unit.log`、`/tmp/ella-pad-build.log`。
- Chrome、WebKit各核验768×1024、820×1180、1024×1366、1024×768、1180×820、
  1366×1024；Chrome另验390×844、320×568、1440×900。浏览器隔离上下文，
  不访问用户现有学习记录；尚未在实体Pad核验。
- 使用当前真实题库各题型最长文本，核验首页、阅读、词汇、填空、听力、正确解析、
  本组结果及课程页。页面无横向溢出、选项与按钮无裁切；实际点击记录正确答案。
  820px下真实MP3时间推进且error=null，停止和展开听力文本正常。
- 1180px横屏：卡片两侧210px→约26px，卡片760px→约1128px，正文18px→28px，
  问题25px→32px，选项18px→约26px。820px竖屏正文26px、问题32px、选项24px。
  各Pad选项高度至少80px，解析22px；阅读正文1.8行高，长内容纵向滚动。
- 证据`/tmp/ella-pad-qa/{before,after}/`，脚本`/tmp/ella-pad-qa.py`。
  第一轮脚本按DOM查询audio超时；播放器使用脱离DOM的真实Audio实例，
  改为观测实际实例后Chrome/WebKit播放通过，没有因此修改产品音频逻辑。
- 用户可查看工作区`Ella-Pad适配预览-0.4.11/`三张截图，以及本地预览
  `http://localhost:4173/`、重新生成的工作区根目录`英语复习小站.html`。
  未提交、推送或发布；线上仍为0.4.10，待用户视觉复核与新的发布指令。

## 0.4.10五项P1修复与重新发布（2026-11-20）

- 用户授权修复5项P1并重新发布；提交`2c5cd7cf13ec0e042540537bdb0e9723f10e99ed`
  已正常推送main。[Actions 44685342799](https://github.com/fkzeal/ella-english-review/actions/runs/44685342799)
  success；云端Node22.23.5，76项测试全通过，83题构建/部署成功。
- 本地新增回归先在旧代码确认7项失败，修复后76/76通过。未升级依赖。
- 原网址`https://ella-english-review.pages.dev/`实测0.4.10/r6/`f83e93f3878f`，
  builtAt=`2026-11-20T06:05:48.381Z`。
- 本地和生产Chrome隔离上下文：后台fetch阻塞期间两次旧题点击，
  另一标签答题后旧点击全部丢弃；新题需新点击才写入正确答案。
- 保存等待真实Web Lock期间切到家长页，写入完成后家长页保持；记录成功保存。
- 模拟旧r5题库/清单热更新r6，新增听力请求新清单和实际MP3，
  currentTime持续推进、rate=0.82、paused=false、error=null；停止有效。
  清单404控制下旧题库和已存原文完全不变，没有假同步成功。
- 真实文件输入/确认流程：单题patch目标引用旧题成功，整课snapshot退役成功，
  旧目标/题目/作答均保留，停用课退出课程展示；完整备份恢复和刷新后历史保持。
- 晚到复读控制：同组新作答不遮挡老分项，due从2026-12-01提前至2026-11-19；
  其他分项与history不变，重复同步幂等。新增测试也覆盖旧回执已写但漏调的记录。
- 六猫依次循环回橘猫、日期保存/刷新恢复、1280/390/320px无横向溢出通过；
  本地单文件真实内嵌音频播放通过。
- 生产题库、app/engine/audio-player、JSON音频清单、6张猫图和试听MP3，
  SHA256均与本地dist一致；`audio-manifest.json`响应缓存头为`no-store`。
- 证据在`/tmp/ella-p1-*`及`/tmp/ella-p1-browser/`，本地/线上浏览器均PASS。
  普通Python urllib曾收到403，改用真实浏览器同源请求验证成功；
  不据此推断微信或整个pages.dev状态。未访问用户现有生产浏览器进度。
- 本地接手文档继续保留为未提交文件；产品提交没有混入既有文档修改。
  跨日首页展示更新、既有部署依赖告警和微信域名问题不在本轮修复范围。

## 0.4.9全项目审查核验（2026-11-20）

- HEAD仍为 `bfb57d1711fc259ea5b15418dcbb30b6dc5df269`，版本0.4.9/r6。
- 现有65项测试全部通过；从HEAD导出到临时目录隔离构建，83题与媒体资源检查通过。
- 真实Chrome隔离上下文禁用Web Locks，IndexedDB CAS两写结果为一成功、一ConflictError；
  损坏测试原文不被空记录覆盖，恢复备份后before-restore保留原文、刷新可继续使用。
- 双标签真实点击复现：两次旧题点击均显示gt-veg-q01，跨标签同步后第二条却给
  gt-veg-q02写入selected=0/correct=false，确认需绑定事件题目身份。
- 旧页面热更新新听力的隔离浏览器复现：新MP3与新清单存在，但播放器仍旧清单，
  无MP3请求而走设备备用声音。
- Node输入与控制实验复现：整课snapshot退役、单题patch引用解析、晚到复读分项调度。
  每项均核对直接调用链；全部优先问题为条件性P1，无已确认P0。
- 音频扩展控制：合法84题/17份录音通过校验和构建，但测试固定16而失败，留作工程优化。
- 报告在项目根目录 `Ella-代码审查-2026-11-20/report.html` 与 `report.md`。
  未重新获取教材原图，未进行实体手机或微信访问解封验证，未重新联网依赖审计。
- 本轮未改产品源文件、提交、推送、发布，也未读写用户既有生产浏览器进度。

## 后续0.4.9左右布局核验（2026-11-19）

- 同一课程卡片要求的继续调整：剑桥模块标题与日期选择器同排，右侧日期统一对齐。
- Node22下65项测试通过，构建成功；My week卡片比0.4.8再减少约92px。
- 本地和线上1280、1001、390、320px实测三个标题完整不换行、与日期垂直居中、
  无横向溢出；日期选择器操作高度44px。
- 本地隔离上下文内模块日期修改保存与刷新恢复正常，其他模块日期不变。
  RAZ默认入口及整本日期保持，题库和既有生产记录未修改。
- 提交 `bfb57d1711fc259ea5b15418dcbb30b6dc5df269` 正常推送main，
  [Actions 44465355631](https://github.com/fkzeal/ella-english-review/actions/runs/44465355631)
  completed/success。
- 线上 `/version.js` 实测0.4.9/r6/`b2204c039bc2`，
  builtAt=`2026-11-19T05:28:25.248Z`。题库JSON与六张webp均与本地文件逐字节一致。

## 后续0.4.8发布核验（2026-11-19）

- 用户明确授权压缩课程卡片、RAZ排序及默认入口修改后直接发布。
- 提交 `aedb1253d2a50f2425c297831d40f4a3514937b5`，main正常推送，无强推。
- Node 22下65项测试通过，构建成功，题库仍为r6/83题。
- Playwright实测本地及线上1280、390、320px，日期标签为“首次学习”、
  分类顺序RAZ/剑桥/KET且首次默认RAZ；无横向溢出，日期输入最小高度44px。
- RAZ卡片减少约83px，My week卡片减少约115px。
- 隔离本地上下文内日期保存和刷新恢复通过，剑桥模块仍独立；未操作既有生产进度。
- [Actions 44464629748](https://github.com/fkzeal/ella-english-review/actions/runs/44464629748)
  completed/success，对应上述提交。
- 线上 `/version.js` 实测0.4.8/r6/`ec5fbd427364`，
  builtAt=`2026-11-19T05:21:57.088Z`。线上课程卡片与本地测量结果一致。
- 线上题库JSON与六张猫咪webp均成功读取，并与本地文件逐字节一致。
- 发布提交只包含本轮UI、版本、更新日志和既有测试适配；迁移记忆仍保存在本地。

## 初次0.4.7迁移核验（历史）

核验日期：2026-11-19。应用保持 **0.4.7**，题库保持 **r6 / 83题**。
本次只迁移和验证，没有提交、推送、部署或产品功能修改。

## 仓库与项目

- 实际 Git 仓库：`/Users/Ivens/Documents/trae_projects/Vibe Coding/ella-english-review`
- 复用来源：`/Users/Ivens/Documents/Trae-CN/temp_20261119_01/ella-english-review`
  （现为指向新目录的兼容符号链接）。
- 迁移前工作区干净。main、origin/main 和远端 main 均为
  `1f74906b70887dcdc39207a7218589e7f79b4811`。
- origin：`https://github.com/fkzeal/ella-english-review.git`。
- `ella-0.4.7.bundle` 通过 `git bundle verify`，包含完整 main 历史；
  因已找到有效仓库，未重复克隆。
- TRAE 应用界面实测显示“与 Vibe Coding 对话”下的
  “Ella英语复习站本地迁移与核验”任务。项目目录与当前任务归属都已核实。
- 项目根目录 `AGENTS.md` 已建立接手入口，`.trae/environments/run.json`
  已保存并校验启动动作，工作目录为 `ella-english-review`。

## Node、构建与预览

使用官方 Node 22.23.5 arm64，安装包 SHA256 与官方清单一致；
工具在 `$HOME/.local/share/node-v22.23.5-darwin-arm64/`。
没有修改系统默认 Node、shell 启动文件或全局 Git 配置。

| 项目 | 结果 |
| --- | --- |
| `npm ci` | 成功，锁文件未变 |
| `npm test` | 65通过，0失败，0跳过 |
| `npm run build` | 成功，校验83题、静态音频和猫图 |
| 本地版本 | 0.4.7 / r6 / `783b1725451c` |
| 本地预览 | http://localhost:4173/ |
| 端口与进程 | 4173空闲后启动本任务服务，未停止其他任务 |

`server.js` 服务 dist；源代码修改后需重新构建。
构建同时生成 Vibe Coding 根目录的 `英语复习小站.html`。

## 浏览器交互核验

先用外部 Chrome 检查首页和答题，随后用独立 Playwright Chromium 上下文
完成尺寸和媒体验证；使用本机 Chrome 二进制，测试数据仅存在隔离上下文中。
以下均为实测，不以单元测试替代浏览器交互。

| 项目 | 证据 |
| --- | --- |
| 桌面布局 | 1280px宽；首页图片加载，页面及控件无横向溢出 |
| 手机布局 | 390×844与375×812；首页、题目、答对反馈和家长页均检查 |
| 猫咪轮换 | 实际答对依次出现 ginger → tuxedo → calico → gray → siamese → cream → ginger |
| 错题反馈 | 显示“没关系，我们一起看看为什么”和解析；标出所选错误项与正确项，不出现cat-cheer奖励 |
| 正常听力 | 本站MP3真实播放，rate=1，currentTime持续推进，paused=false，error=null |
| 慢速听力 | rate=0.82，preservesPitch=true，前一音频停止；重听后提示勾选仍为false |
| 停止 / 离开 | 停止后原生媒体paused且src清除；离开练习也停止 |
| RAZ日期 | 两本可用绘本各一个首次日期字段，没有模块日期或已学勾选；修改后提示保存，刷新后保持 |
| 剑桥日期 | lv / rg / skills三个模块各自日期；修改lv时其他模块不变 |
| 进行中练习保护 | 未结束练习时禁止改日期；在无进行中练习的隔离上下文中保存成功 |
| 每组题量 | 6、10、15、20 |
| 减少动画 | reduced-motion下奖励动画为none |
| 浏览器错误 | 独立本地测试未发现pageerror或失败请求 |

初次Chrome桥接页面被报告为hidden，听力停留准备状态并进入备用音色；
这不是最终验证环境。独立浏览器页面visibility=visible，本站MP3播放通过。
声音验证证明解码、播放事件、播放进度、速率和停止正常；没有冒称人工听感评价。
手机为浏览器视口模拟，未声称完成实体iPhone或Safari设备测试。

外部Chrome的初步点击留下少量localhost测试记录；没有清空。
原生产域名既有浏览器进度未读取或覆盖。生产网页核验使用独立上下文，
不涉及用户常用浏览器数据。`lesson-loop-data-v1`保持不变。

## GitHub 与线上

- 本地身份：`fkzeal`，钥匙串认证有效，repo权限为ADMIN。
- gh程序在 `$HOME/.local/bin/gh`，配置在 `$HOME/.config/gh`；
  从原临时位置持久化，未读取或输出Token。
- `gh api user`、`gh repo view` 与远端main读取成功。
- 通过单次命令的gh credential helper执行 `git push --dry-run --porcelain origin main:main`，
  返回 `[up to date]` / `Done`。这是模拟结果，没有实际上传新提交。
- 已有提交的 [GitHub Actions运行](https://github.com/fkzeal/ella-english-review/actions/runs/44457848293)
  状态为completed / success。
- 生产 https://ella-english-review.pages.dev/version.js 返回：
  `app=0.4.7, bank=6, build=783b1725451c, builtAt=2026-11-19T04:22:29.971Z`。
- 生产首页实际渲染正常；六张webp均成功下载，与仓库文件逐字节相同。
- Actions仍为push main部署既有Cloudflare Pages，未创建新项目或重新配置Secrets。

## 保留的待办

1. `npm ci` / `npm audit` 提示6项high：wrangler、miniflare、sharp、undici、ws、zod，
   属于锁定的开发/部署工具链。未执行 `npm audit fix` 或升级锁文件，后续单独评估。
2. 等待新素材：Greater Than第10页、Country Places正文；不能根据标题补写。
3. 飞书原图归档、接收时间戳、每日增量生成题库仍未实现，没有配置定时任务。

当前无需要用户补做登录、权限或项目关联的阻塞项。
本轮接手文档为本地未提交修改；未来任务先读五份入口文档，再按新需求维护。
