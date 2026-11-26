# 变更说明：v0.1.2 之后（本地待发布）

- 状态：**草稿，未发布**。本地源码已有改动，公开仓库与 Release 仍是 v0.1.2。
- 对比基准：公开仓库 `CrunchSYAH/xiaren-releases` 分支 `main` 提交 `b71e5ae`（"Publish Xiaren v0.1.2 source and updater"，2026-10-22T16:22Z），等于 Release `v0.1.2` 的源码。
- 对比方式：按发布白名单的 44 个文件逐个下载远程原始文件，与本地同路径做 `cmp` / `diff -u`。除 README 外，差异全部位于 `extension/`。
- 对比时间：2026-11-11。
- 版本号：`extension/manifest.json` 与 `package.json` 仍为 `0.1.2`，**本次未升版**。

## 一、差异总览

| 文件 | 增 / 删行 | 性质 |
| --- | --- | --- |
| `extension/core/backend.mjs` | +86 / −29 | 缺陷修复 + 并发隔离 + 日志白名单 |
| `extension/core/image-assets.mjs` | +27 / −12 | 性能优化（校验强度不变） |
| `extension/background.mjs` | +29 / −1 | 单工作台复用 |
| `extension/content.js` | +15 / −1 | 发送前只读等待 |
| `extension/history.mjs` | +13 / −1 | 搜索防抖 + 中文输入法 |
| `extension/core/task-history.mjs` | +8 / −6 | 单请求单次读取 |
| `extension/core/queue.mjs` | +1 / −1 | 间隔下限 ≥1 秒 |
| `extension/dashboard.mjs` | +1 / −1 | 间隔下限 ≥1 秒 |
| `extension/dashboard.html` | +1 / −1 | 间隔输入 `min` 改为 1 |
| `README.md` | +65 / −16 | 非发布差异，见第六节 |

其余 34 个白名单文件（`manifest.json`、`package.json`、`.gitignore`、`distribution/*`、`scripts/package-release.mjs`、其余 `extension/*`）与远程逐字节一致。`extension/` 两侧均为 36 个文件，无新增或删除文件。

## 二、缺陷修复

### 1. 专用页离开卖家站后不再抛 `TypeError`

- 位置：`core/backend.mjs`（`SELLER_ORIGIN`、`tabUrl()`；`inject()` 内 3 处、`panel:open` 内 1 处）。
- 原问题：扩展未申请 `tabs` 权限，专用页一旦离开 `seller.shopee.co.id`，`tab.url` 为 `undefined`，原代码直接 `new URL(tab.url)` 抛错，导致注入失败、且"打开专用 Shopee 页"无法自愈。
- 现在：地址不可见或无法解析即判定"不在目标来源页"，直接导航回目标 URL 并重建绑定。
- 兼容性：**没有新增 `tabs` 权限**（`scripts/check.mjs` 断言权限只能是 storage / scripting），只依赖 `runtime.getContexts`。

### 2. 准备阶段不再被自己的短超时打断

- 位置：`core/backend.mjs`（`PAGE_TIMEOUT = 45s`、`PREPARE_TIMEOUT = 90s`，`expire()`）。
- 原问题：统一 45 秒动作预算。执行器单轮准备本身可长于 45 秒（翻页 `open-chat` 最多 160×250ms，再等聊天面板 40×250ms），慢导航会被自己判成"页面响应超时"。
- 现在：待处理项含 `sending` 仍用 45 秒；仅 `preparing` 时放宽到 90 秒。页面静默（`lastSeen`）判定保持 45 秒不变。

### 3. 两个工作台不再互相作废预览令牌

- 位置：`core/backend.mjs`（单变量 `preview` → `previews: Map<工作台标签页, 令牌>`，`previewKey()` / `rememberPreview()` / `clearPreviews()`，上限 4 条）、`background.mjs`。
- 原问题：任一工作台刷新或换选会清掉全局唯一令牌，另一份工作台的"预览 → 启动"必然报"配置或页面已变化"。
- 现在：令牌按来源标签页隔离；页面绑定、名单版本、店铺、来源、任务中断等变化才统一清空全部令牌。`sender` 从 `handle()` 透传到 `panel()`。
- 顺带：工具栏图标改为**复用已打开的工作台**（`runtime.getContexts({contextTypes:['TAB']})` 查找，忽略 `#` 锚点；不可用时退回 `tabs.query`），不再每次叠加标签页。找不到或已关闭才新建。

### 4. 文字消息必须确认真实就绪才申请发送许可

- 位置：`content.js`（`mode === 'send'` 分支）。
- 原问题：`setText()` 后立即申请许可。React 可能尚未把值刷入自身状态、发送按钮仍是 disabled，会出现"点了没反应"或文本未生效就提交。
- 现在：`setText()` 后**只读**轮询（最多 20×150ms），必须同时读到 `editorText === command.text` 且 `sendReady` 才申请许可；超时抛白名单原因：
  - `发送控件尚不可用，已阻止发送`
  - `消息文本与预览不符，已阻止发送`
- 等待期间不点击、不清草稿、不重填；一旦发现已有附件（`mediaCount`）或回复（`replyCount`）立即停止等待。

### 5. 逐人间隔统一为不小于 1 秒

- 位置：`dashboard.html`（`min="1"`）、`dashboard.mjs`（`< 1`）、`core/queue.mjs`（`< 1`）。
- 原状：输入框 `min=0` 但校验要求 `> 0`，0.5 这类小数能通过界面、语义上却接近连发。
- 现在：三处口径一致为 ≥ 1 秒。旧记录的兼容：`core/task-history.mjs` 的归档快照仍按 `> 0` 放行，`resume` 不重新校验，已存在的小数间隔任务仍可继续，不会被判非法。

### 6. 历史搜索防抖并避让输入法

- 位置：`history.mjs`（`QUERY_DELAY = 250`、`scheduleQueryLoad()`、`compositionstart/end`、`loadList()` 开头清定时器）。
- 原问题：每次按键都重新读取并校验全部归档任务，中文输入时每个候选字符都发一次请求。
- 现在：输入停止 250ms 后才请求；输入法组合期间不发请求，`compositionend` 后再触发。筛选下拉、刷新按钮仍即时加载。

## 三、性能优化（校验强度不变）

### 7. 图片库一次请求只校验一次

- 位置：`core/image-assets.mjs` 新增 `listVerifiedAssets()` / `getVerifiedAsset()` / `appendVerifiedAsset()`；`core/backend.mjs` 图片分支。
- 原状：一次 `panel:image-add` 会先后 4 次完整读取并对全库每张图重算 SHA-256，列表/单取各 2 次。
- 现在：一次请求只 `readImageAssets()` 一次（仍逐张重算摘要），列表、单取、追加都从这份已验证结果投影。实测摘要调用：list 6→3、get 6→3、add 13→4。
- **明确放弃**了"列表只做结构校验"的方案：`tests/image-backend.test.mjs` 要求资产摘要被篡改时三个图片接口全部 fail-closed，该不变量优先于性能。`listImageAssets` / `getImageAsset` / `addImageAsset` 作为"原始存储 → 全量校验"的严格入口保留。

### 8. 任务记录一次请求只读一次归档

- 位置：`core/task-history.mjs`（`mergedTasks(saved, currentTask)` 改为接收已读 store；`listTaskHistory` 复用同一次读取）。
- 原状：`listTaskHistory` 内部两次 `readTaskHistory`，每次都要校验全部归档任务。

## 四、可观测性

### 9. 准备阶段的拒绝原因可进排查日志

- 位置：`core/backend.mjs`（新增 `PREPARATION_REASONS` 白名单，`logReason()` 先查该集合）。
- 原状：准备阶段的固定中文原因（来源不符、人数不符、筛选未稳定、页面未就绪等 28 条）不在 `SAFE_REASONS` 内，导出日志里看不到，只能看到笼统错误。
- 现在：这些固定文案原样入日志。日志仍不记录身份、正文、URL、凭证或堆栈；未知异常只记错误类型。

## 五、兼容性结论

- **存储**：无新增键、无 schema 变更，`creatorQueue` / `creatorTaskHistory` / `creatorMessageTemplates` / `creatorImageAssets` / `creatorDiagnostics` / `creatorLibrary` 均沿用；旧数据可直接读取。
- **权限**：`manifest.json` 未变（仍是 storage、scripting + `seller.shopee.co.id`），未新增主机或 API 权限。
- **任务**：旧单／双消息任务与旧模板配置仍可用；旧小数间隔任务在 `resume` 后仍继续（不再新建）。
- **行为收紧**：新建任务间隔必须 ≥ 1 秒；文字消息在发送按钮未就绪时会被阻止而非强行点击（这是**有意的**行为变化，发布说明里应写明）。

## 六、发布注意：README 不能直接覆盖

公开仓库的 `README.md`（2026-10-22 提交，约 2.3 KB）是**对外精简稿**，本地 `README.md`（约 104 行）是内部开发稿，含 `docs/`、`AGENTS.md`、本地夹具与验证记录等仅内部可见的引用。

同步时必须继续使用对外稿（按本次改动补一句"发送前等待控件就绪"与"间隔 ≥1 秒"即可），**不要把本地 README 原样上传**。

## 七、验证状态

- `node scripts/check.mjs`：通过（语法检查 39 个文件、3 段夹具脚本与本地测试版；Manifest 权限及无外部请求检查通过）。
- 正式 Node 测试（排除 `local-build.test.mjs`，跳过动态 CMD 启动检查）：**510 项通过，0 失败**，耗时约 27.5 秒。
- 仍未验收（与本轮无关，发布说明须保留）：真实 Shopee 发送、真实发图、平台接受/送达/已读、双 profile 实机同时运行。
- 本轮未触碰业务发送、存储格式与权限；未运行、未生成暂停中的本地测试插件。

## 八、后续改动（待补）

> 用户已明确还有改动要做。本节用于逐条追加；改完后再决定是否升版发布。

- （待补）
