# 目标人数备齐名单实施计划

> **For agentic workers:** Use executing-plans in this session; follow TDD. 用户已确认设计，直接实施；不提交、不推送、不创建分支。

**Goal:** 在专用达人页面通过真实滚动备齐目标人数后锁定名单，差额明确、不可少发启动，异常仍暂停。

**Architecture:** 收集状态单独保存在 workspace.collection。每次页面 poll 只检查一次完整 DOM 名单并派发一次短滚动动作，后台不等待整个收集。名单绑定浏览器会话、标签页、文档和页面会话及店铺，预览和启动重新核对锁定名单仍存在且符合历史/拒绝规则。

**Tech Stack:** 原生 MV3 JavaScript、Node.js 内置测试、现有页面 MAIN world 白名单核对。

## Global Constraints

- 真实页面只操作自建页的列表滚动；不填草稿、不发送、不调用私有接口。
- 只支持已实测的追加式无限滚动；DOM 替换、身份变化、筛选/排序造成的已有行变化使名单失效。
- 目标为 1–200 正整数；成功人数不能触发补人或重试。
- 不修改 dashboard.*、recorded 夹具、原测试页、构建/预览脚本、README/AGENTS。

### Task 1: 纯收集状态与差额

**Files:** 新增 extension/core/collection.mjs、tests/collection.test.mjs。

- [x] RED：按批次 12→24→…→108，排除历史/拒绝/无入口，100人前不可 ready；结束不足显示准确差额。
- [x] GREEN：实现 createCollection、updateCollection、invalidateCollection 与 binding 校验；保留累积身份锚点，检测替换/改名/入口失效。
- [x] 校验整数边界、相同批次等待超时、会话变化、载入上限。

### Task 2: 后台短步骤收集与锁定启动

**Files:** 修改 extension/core/backend.mjs、必要 queue.mjs；新增 tests/target-backend.test.mjs。

- [x] RED：panel:collect 启动、page:poll 返回 collection-step、panel:cancel-collection 立即失效，旧动作不得执行；非 completed 任务/存储故障阻断。
- [x] GREEN：收集动作持久化后才操作页面；每轮只一个同步滚动；保存收集状态、反馈 target/count/shortfall。
- [x] RED/GREEN：collectionId 配置预览/启动必须精确匹配锁定100人；不可见者不信任缓存；拒绝变动、导航、账号变化阻断。
- [x] 保留手工模式预览兼容、单次许可/回执/异常暂停原链路。

### Task 3: 页面追加加载与发送定位

**Files:** 修改 extension/page-snapshot.mjs、extension/content.js；新增 tests/target-page.test.mjs、tests/fixtures/target-count.html。

- [x] RED：MAIN world 核对店铺/文档/原名单指纹后才滚动，返回已观察的 hasMore/loading；旧令牌不能滚动。
- [x] GREEN：通过真实 .kol-loading-more / .kol-card-layout-global 读取白名单 hasMore/loading，不调用回调或网络接口；scrollIntoView 触发加载。
- [x] RED/GREEN：发送准备先获得后台对当前达人身份和行键的校验，再以 MAIN world 同步身份核对点击聊天；保留无草稿演练。

### Task 4: 集成契约与复审

**Files:** 新增 docs/target-count-integration.md。

- [x] 给出消息、配置、返回字段、状态机及 UI 自动 preview→start 契约。
- [x] 独立审阅主链路、状态、存储失败、取消/导航/筛选/店铺变化及边界。
- [x] 运行 node --test tests/*.test.mjs 和 node scripts/check.mjs；记录真实页面观察和未验证的发送部分。
