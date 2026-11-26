# 消息规则单一来源、发布门禁与体检修复（2026-11-18）

## 背景

下一阶段开发前对 `extension/` 做了一次完整体检：基线为单提交 `726602d`、工作区干净，`node scripts/check.mjs` 通过、530 项测试通过。体检列出的问题按返工成本分级，本轮先做其中的 P0 三项与 P1 一项（测试入口对齐），其余列入遗留。

## 改动

### 1. 消息规则集中到 `extension/core/message-rules.mjs`

原状：条数与字数上限（10 条、2400 字、2000 字、80 字、200 人）和链接校验正则同时存在于 `core/queue.mjs`、`core/message-templates.mjs`、`dashboard.mjs` 三处；值当时一致，但没有任何一处是唯一来源。

- 新模块导出 `MAX_MESSAGES` / `MAX_TEXT_LENGTH` / `MAX_LINK_LENGTH` / `MAX_TEMPLATE_LENGTH` / `MAX_TASK_NAME_LENGTH` / `MAX_CREATORS` / `MESSAGE_TYPES` / `NAME_VARIABLE`，以及谓词 `isDeliverableLink()`、`hasUnknownVariable()`。
- 三处调用方改为读取常量，抛错文案改为从常量拼出，避免文案与数值再次漂移（例：`最多 ${MAX_LINK_LENGTH} 字`）。
- 链接校验语义不变，只是把「完全不是网址」与「是网址但不允许发」的分流集中到谓词 + 调用方各自的文案，原有测试全部保持通过。
- `scripts/check.mjs` 新增守卫：这三个文件里再出现 `2400`/`2000` 字面量即报错，防止改回去。

### 2. 发布流水线加测试门禁

`.github/workflows/publish-release.yml` 原来只在 push main 时读版本号、打包、发 Release，没有任何检查。由于扩展内自动更新会把用户直接升到新包，一个「版本号 + 缺陷」的提交可以直达用户。

- 新增 `verify` job（`windows-latest`，与本地工具链一致，25 分钟超时）：`node scripts/check.mjs` + `node scripts/test.mjs`。
- `publish` 改为 `needs: verify`，验证不过不发版。

### 3. 验证命令统一为一个入口

原状：`package.json` 的 `test` 跑 `tests/*.test.mjs`（含已暂停的 `local-build.test.mjs`），与 AGENTS.md/README 认可的 PowerShell 命令不一致。

- 新增 `scripts/test.mjs`：固定排除 `local-build.test.mjs`、跳过「通过真实 CMD 从其他目录运行启动入口」、并发固定为 2（默认并发下 `tests/image-backend.test.mjs` 会挂起）。
- `npm test` → `node scripts/test.mjs`；新增 `npm run verify` = check + test；CI 跑同样两条命令。
- README「开发验证」与 AGENTS.md 的验证命令段同步改写。

### 4. 修复 `scripts/check.mjs` 在 Windows 上失效的守卫

`walk()` 用 `path.join` 产出反斜杠路径，而 `updaterFiles` 用正斜杠键做 `Set.has()` 比较——在 Windows 上永远为假，导致：

- 「只有 `updater.mjs`／`update.mjs` 可以访问网络」的豁免从未生效（因为更新器用 `fetchImpl()` 调用，恰好绕过了 `\bfetch\s*\(` 正则，才没有报错）；
- 「更新器只访问四个 GitHub 域名」的白名单扫描是在空字符串上跑的，等于整段跳过。

修复：比较前统一 `replaceAll('\\', '/')`；顺手把禁用正则从 `fetch\s*\(` 收紧为 `fetch\w*\s*\(`（覆盖 `fetchImpl` 等别名）；白名单扫描前排除权限常量所在行，避免把「权限清单里允许的卖家域名」误判成网络调用目标；并断言确实读到了更新器源码。

### 5. 并行会话 `core/history-window.mjs` 的集成缺口

体检期间另一会话正在新增「防重发记录 30 天过期」功能（`core/history-window.mjs`，已接入 `queue.mjs`／`backend.mjs`／`collection.mjs`／`dashboard.mjs`）。本轮不改其逻辑，只补齐因新增模块而漏掉的三处清单与一处时钟：

- `scripts/build-local-test.mjs` 的 `names` 清单补 `core/message-rules.mjs`、`core/history-window.mjs`（漏了会让本地测试版在运行时才因模块缺失失败，语法检查抓不到）。
- `scripts/verify-recorded-page.mjs` 的拼接模块清单同步补齐，并把 import 剥离正则从「只吃单行」改成「吃到 `from '…'` 为止」，否则多行 import 会残留 `} from '…';` 导致拼接结果语法错误。
- `tests/dashboard.test.mjs` 的 VM 装载器改为注入 `message-rules` 与 `history-window` 的命名导出（原来的正则只剥离单行 import）。
- `tests/message-sequence.test.mjs` 的一处 `previewTask(state, config())` 补 `{ now: 1000 }`：记录带 `updatedAt` 后，默认 `Date.now()` 会把测试时钟写入的记录当成已过期。

## 验证

- `node scripts/check.mjs`：44 个文件 + 3 段夹具脚本 + 本地测试版语法检查通过；Manifest 权限、外部请求、消息上限字面量守卫通过。
- `node scripts/test.mjs`：537 项通过（含并行会话新增的 `history-window` 用例），耗时约 32 秒。
- 未在真实 GitHub Actions 上跑过，`verify` job 的实际耗时与 Windows runner 行为待首次发版确认。

## 遗留

- `tests/image-backend.test.mjs` 在默认并发下偶发无输出挂起，根因仍未定位；当前以并发 2 规避。
- 体检清单中的 P1/P2 未动：`dashboard.mjs` 单文件 1500 行、`backend.mjs` 的长 if 路由链、无 ESLint/Prettier、`minimum_chrome_version` 106 与 FSA 持久授权需 122 不符、执行器停摆只靠超时暴露等。
- 真实 Shopee 发送与回执仍未验收。
