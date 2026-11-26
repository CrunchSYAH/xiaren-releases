# 排行榜与共享发送链路最终集成

status: ready

2026-10-20。本轮只在工作树修改，未创建分支、提交或推送；未修改 affiliate-resolver / creator-library 独占模块。其交接均已 ready 并按现有接口接入。

## 最终实现与接口

- 排行榜：`source.type=leaderboard`，从当前榜单第一页按真实挂载顺序准备1—200目标；按Shopee用户ID去重保留首次出现。`core/leaderboard.mjs` 维护每页完整名单、当前页、已落盘目标页和45秒时限；榜单/周期/分类/渠道/页大小/总数形成来源锁。仅适配当前20人一页、最多200名的普通替换分页；未知结构、虚拟挂载不支持。
- 指定联盟伙伴：`source.type=affiliates` 与独立 `affiliateIds`；`core/affiliate-source.mjs` 消费 ready 的 resolver 模块，逐个官方详情核对映射、店铺、文档、入口，按输入顺序锁定。任一缺失、冲突、别名收件人重复、被历史/拒绝或姓名条件排除都不补人启动。原 `specified` 保留已加载Shopee用户ID筛选语义。
- 指定伙伴发送：导航前MAIN同步核对当前资料和全部草稿，精确目标URL、目标ID、原文档、任务会话、集合和45秒时限先落盘，再停止旧执行器并导航。只有匹配的新hello可重绑；内部 `source-document` 仅接受当前preparing目标，旋转会话并重置为待准备，暂停/停止不恢复运行。人工导航、超时、错误目标或映射变化均失效。
- MAIN提交：广场核对原名单前缀；排行榜核对目标页完整行序与来源；详情同步调用同文档安装的 resolver，核对完整映射及聊天收件人。图片预备和最终点击都要求来源锁，仍保留精确File、单次图片令牌、逐条授权和声明先落盘。发送结果不明不重试、部分提交不重发，组内连续调度保留。
- 达人库：共享backend在业务enqueue、initialize和faulted检查前分流独立handler。工作台新页打开库，保存消息草稿；交接精确校验扩展origin与准确窗口。仅显式套用时按库revision和当前店铺重新读取选择，撤销旧集合/预览/确认，只填写指定已加载用户ID，仍须当前专用广场准备。无可信用户映射的伙伴ID记录不能直接套用；本轮不自动写入 page_verified。

共享改动：`core/backend.mjs`、`core/queue.mjs`、`core/collection.mjs`、`core/audience.mjs`、新增 `core/leaderboard.mjs` / `core/affiliate-source.mjs`、`page-snapshot.mjs`、`content.js`、`dashboard.html/mjs`、`history.mjs`、AGENTS及README。Manifest权限保持原值，无外部服务或凭证依赖。

## 真实页面非发送证据

- 独立自建后台页确认 Top Sales、Fast Growing、Popular Shopee Contents 均有20行、真实 affiliateId / affiliateUserId 与行内Chat链接。Top Sales和Popular榜各一次聊天核查：资料用户ID、编辑器/会话收件人和当前店铺一致；Fast Growing未打开聊天。
- 实际最终排行榜适配器在Popular榜完成1→2→1受控翻页，整页名单/顺序/入口和来源快照一致；原生分页替换行，未沿用广场追加假设。第二页一条displayName含首尾空白，只做trim归一化，未按相似姓名或数字猜身份。
- 实际适配器受控打开Popular榜聊天并复查草稿为空、附件数0；未写正文、未选图、未发送。唯一自建研究页已关闭，未操作原有任务标签页。
- 脱敏证据：`docs/leaderboard-evidence-2026-10-20.json`，仅字段、路径、数量与布尔比较，无原始身份/正文/凭证/完整DOM。
- 指定伙伴真实详情证据由模块所有者提供，见 `docs/handoff-specified-affiliates.md` 及其证据JSON；仅一个详情样本。达人库独立页面及数据测试见 `docs/handoff-creator-library.md`。

## 最终验证

PowerShell：

```powershell
$formalTests = @(Get-ChildItem tests -Filter *.test.mjs | Where-Object Name -ne 'local-build.test.mjs' | ForEach-Object FullName)
node --test --test-reporter=spec --test-skip-pattern="通过真实 CMD 从其他目录运行启动入口" $formalTests
node scripts/check.mjs
```

- 最终393项通过、0失败；排除local-build文件，并跳过下述有副作用的旧launcher动态检查。覆盖已有文字/链接/图片、逐条声明、迟到回包、部分提交、暂停停止、恢复、防重发、历史/模板/图片/诊断隔离，以及所有本轮独立模块和新增集成行为。
- 排行榜200人跨10页完整演练按首次行序完成；25人三条混排75次替身提交及定位回包暂停通过。指定伙伴使用实际content执行器跨官方详情文档完成两人三条混排，每条独立授权；部分提交暂停恢复不重发、点击结果未知不重试、演练零提交通过。
- 共享库早分流测试使用故意不可初始化的业务数据，成功/失败/伪造来源仅触及creatorLibrary；工作台精确窗口、错origin/店铺/版本、未结束任务、消息草稿保留和显式套用后重新准备通过。
- `node scripts/check.mjs`：33个文件及3段夹具脚本语法、Manifest权限和无外部请求检查通过。该脚本只在内存构造本地测试源码，不落盘测试插件。
- 初轮并行构建中的库标签回归由库模块所有者修正，其ready版本及最终全量已通过；集成方未修改独占文件。

## 发现的测试副作用与处理

首次按“全部测试仅排除local-build”运行时，既有 `launcher.test.mjs` 仍调用真实CMD `--check`；启动脚本先执行build-local-test，间接生成了 `artifacts/extension-local-test/`。这违反暂停本地测试插件的约束，是本轮检查遗漏；未安装、未运行插件或真实发送。发现后停止运行该动态检查，未继续修复/清理/覆盖本地测试目录；AGENTS与README已记录暂停期间的安全验证命令。此前未跳过launcher的一轮394项也通过，最终以393项无此副作用的结果为准。

## 证据边界与复核

已重读来源规范化→集合→受控翻页/导航→会话绑定→content准备/填入→图片预备→逐条授权→声明落盘→MAIN点击→结果保存→间隔，以及库独立分流/窗口交接/显式套用和历史来源显示。既有来源未改成详情或排行榜的宽泛路径放行；旧单/双消息保持配置。

Node中所有提交均为明确替身；真实发送、平台接受/送达/已读、真实发图及已安装扩展的新来源完整人工验收均未执行。排行榜完整实页翻页循环只核查Popular榜前两页，不能视为实站200人验收；其他榜单、日期/分类组合、页面语言变化、长期限流、账号权限和任意伙伴ID可用性未穷尽。未知页面结构与无法核实身份必须阻止，不能绕过。

下一步：主控审阅本报告及两个ready模块交接；如需实站验收，先由用户指定测试伙伴和明确发送范围，当前默认仅非发送检查。
