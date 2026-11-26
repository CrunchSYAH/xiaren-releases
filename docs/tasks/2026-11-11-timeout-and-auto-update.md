# 名单准备超时与自动更新（2026-11-11）

## 用户反馈

1. 准备名单经常超时；截图显示 `候选人 15 / 110 · 已选 15 / 100`，提示「名单准备超时：目标 100 人，可用 15 人，仅缺 85 人；不能启动」。附两份导出排查日志（`虾仁-排查日志-2026-11-11T07-08-23-672Z.json`、`…07-09-26-760Z.json`）。
2. 此前的 GitHub「拉取更新」不是想要的效果；需要自动从 GitHub 下载并自动更新，不要手动下载 ZIP。

## 日志证据

- 日志 1（1240 条，已丢弃 7828 条）：15 次 `page:timeout`，每次 `actionAgeMs` ≈ 45–57 秒、`sinceLastSeenMs` ≈ 9–13 秒、`visibility: hidden`；13 次 `panel:resume`，任务在同一 `itemIndex: 36` 反复暂停。另有一次 `sinceLastSeenMs = 80028`、无 `itemIndex` 的静默超时。
- 日志 2（814 条，已丢弃 16516 条）：`collectionStatus: insufficient`，`collectionCount 27 / 100`，原因「页面加载停滞，未取得更多达人」。
- 两次采集的实际速度：13:53 开始 2 分钟后仅 2 人；重新准备后 10 分钟 64 人。按「每页 10 人」估算，约每分钟才前进一页 —— 与 Chrome 对隐藏标签页把链式 `setTimeout` 节流到约每分钟一拍完全吻合。日志中所有超时事件均为 `visibility: hidden`。

## 根因

1. **采集进度依赖页面定时器**：`content.js` 每秒 `page:poll` 驱动滚动加载；专用页在后台被节流后，一页/分钟，110 名候选需要十几分钟，超过 600 秒总预算即失败，且失败后只能从头重新准备。
2. **静默超时按可见页标准判定**：`expire()` 用固定 45 秒判断页面失联，隐藏页正常的一分钟心跳也会被判成「页面响应超时」，导致任务在同一达人反复暂停。
3. **准备阶段的动作预算偏短**：执行器允许 `open-chat` 重试 40 秒 + 等待聊天面板 10 秒，而任务侧动作预算只有 45 秒（当前源码已改为 90 秒，日志中的 45–57 秒暂停即来自旧值）。

## 修复

- `core/backend.mjs`：抽出 `collectStep()`，`page:collect-step` 与新增的 `advanceCollection()` 共用；工作台 `panel:get` 在页面静默超过 4 秒（且无未回执动作、间隔 ≥2.5 秒）时由后台直接滚动/翻页/导航。动作 token 仍保证单次滚动，动作超过 15 秒未回执才允许后台接手。
- 静默超时按可见性区分：可见 45 秒、隐藏 150 秒（两拍节流）；准备阶段动作预算维持 90 秒。
- `core/collection.mjs`：停滞判定 45 秒 → 90 秒，总预算 600 秒 → 1800 秒；新增 `continueCollection()`，`insufficient` 保留候选与选择，可继续加载。
- `dashboard.mjs`：`insufficient` 且已有候选时显示「继续准备候选人」，沿用 `panel:extend-candidates`；文案改为「准备在后台继续」。
- 更新入口 `update.html` / `update.mjs` / 新增 `updater.mjs`：检查 GitHub 最新正式版 → 下载 ZIP 与 `.sha256` → Web Crypto 校验 → 内存解压（`DecompressionStream`）→ 核对 manifest 身份/权限/版本 → 通过 File System Access 只覆写 `extension/` → `chrome.runtime.reload()`；写入前保存快照，失败回滚。
- manifest 新增四个 GitHub 域名的 `host_permissions`（仅更新页只读 GET）；`scripts/check.mjs` 改为「除 `updater.mjs`/`update.mjs` 外禁止 fetch/XHR/WebSocket」并校验更新器只访问这四个域名；`build-local-test.mjs`、`distribution/update.ps1`、发布测试夹具同步新权限清单与 `updater.mjs`。
- 版本 0.1.2 → 0.1.3。

## 验证

- `node --test --test-skip-pattern="通过真实 CMD 从其他目录运行启动入口" tests/*.test.mjs`（排除 `local-build.test.mjs`）：521/521 通过。
- `node scripts/check.mjs`：40 个文件语法、Manifest 权限及外部请求检查通过。
- 新增/更新用例：`tests/updater.test.mjs`（版本、发布选择、校验、ZIP 解压、安装计划、下载白名单）、`tests/collection.test.mjs`（停滞/预算/继续准备）、`tests/target-backend.test.mjs`（后台代采、继续准备）、`tests/backend.test.mjs`（可见/隐藏静默判定）。

## 未验收

- 扩展内自动更新尚未在真实安装目录执行过一次（需要公开 0.1.3 Release；沙箱内无法访问 GitHub）。
- 真实 Shopee 采集速度、真实发送与发图仍未验收；本地夹具通过不等同实站通过。
- 日志容量仍是最近 3000 条 / 1 MiB，本次日志已丢弃大部分历史事件；如需定位更早原因应缩短导出间隔。

## 发布记录（2026-11-13）

- 用户授权后使用细粒度令牌（`Contents: Read and write`）发布。连接器只有 `push_files` 等文本文件接口，没有创建 Release / 上传二进制附件的工具，因此提交与发布走 REST API。
- 提交：`b64f8ac`（45 个文件，源码 + `package.json` + `distribution/` + 公开 README）、`e1d2247`（更新器修复 + 打包脚本）。
- Release：`v0.1.3`（id 443976032，非 draft／非 prerelease，Latest），附件 `xiaren-chrome-v0.1.3.zip`（157804 B，`sha256:f6290ac8fa90e6c4e6bee8c310aa42d3e4cffbad4f441de5698d4c834a8ea7ac`）与 `.sha256`。
- 首次上传的包因下列两个缺陷被自检拦下并重做，第二次上传已替换附件（download_count 仍为 0）：
  1. Windows `Compress-Archive` 把条目名写成反斜杠（`extension\background.mjs`），更新器按正斜杠校验会判成「不安全路径」，即官方包永远装不进去。修法：解压时先把 `\` 归一化为 `/` 再校验 `..`／绝对路径／盘符；`package-release.mjs` 改用进程内 `createZip`。
  2. 权限校验原为「与当前完全一致」，导致 0.1.2（1 个站点）无法升级到 0.1.3（5 个站点）。改为白名单 + 不得减少：只能申请 `storage`／`scripting` 与五个已审阅站点，且不得删除已授予项。
- 端到端验证：从 GitHub 下载发布包（157804 B）重算 SHA256 与声明值一致；用真实 0.1.2 manifest 走 `readArchive` + `planInstall`，得到 v0.1.3、39 个文件、5 项站点权限；`selectRelease` 对线上 release 返回 0.1.3 且下载地址与更新器白名单一致。
- 全量回归 523 项通过，`node scripts/check.mjs` 通过。
- 遗留：0.1.2 无更新器，需手动一次性升级到 0.1.3；`.github/workflows/publish-release.yml` 因令牌缺少 `Workflows: Read and write` 未推送，仓库当前没有自动发布流水线。

## 一键安装包（2026-11-13 补）

- 需求：同事不熟悉"覆盖 extension 文件夹"，希望双击即更新。
- 设计取舍：**不把 install.cmd 放进官方发布包**。已发布的 0.1.3 更新器把「包内出现未知根文件」判为非法（`UPDATER_FILES` 白名单），往发布包里加文件会让 0.1.3 → 新版自动更新失败，而 0.1.3 代码已发出无法回改。因此一键安装做成**独立安装包**：`scripts/package-installer.mjs` → `artifacts/xiaren-installer-v0.1.3.zip`（45 条目：extension + install.* + update.* + release.json + README.txt）。
- `distribution/install.ps1`：从 Chrome／Chrome Beta／Chrome SxS／Edge 的 `<profile>\Preferences` 读取 `extensions.settings`，取 `location = 4`（已解压）且扩展名匹配的 `path`；辅以 `%LOCALAPPDATA%\Xiaren\install.json` 记录。找到后 `Move-Item` 旧 extension 到 `<安装目录>\backups\extension-v<旧版本>-<时间戳>`、`Copy-Item` 新文件、校验版本与关键文件，失败回滚；成功后再同步包根脚本。无记录时按首次安装装到 `%LOCALAPPDATA%\Xiaren` 并打印加载路径。
- 编码坑：`install.ps1` 必须 UTF-8 **带 BOM** + CRLF，否则 Windows 脚本宿主按 ANSI 解析，中文字符串里的引号会打乱语法（首次实测即报「意外的标记『铏句粊』」）。安装记录 JSON 改为无 BOM UTF-8 写出，便于其他工具读取。
- 验证：`tests/install-update.test.mjs` 三条（更新／首次安装／拒绝确认）在 5.1 下通过；构建包内 `install.ps1` 确认带 BOM；全量 526 项通过、`check.mjs` 通过。
- 已把 `xiaren-installer-v0.1.3.zip` 与其 `.sha256` 追加到 v0.1.3 Release（自动更新只按精确文件名匹配前两个附件，多余附件不影响），发布说明补了「一键安装包（可选）」一段。

### 首次实测失败与修复（同日 17:10）

用户在自己机器双击 `install.cmd` 直接报错：`'11' 不是内部或外部命令` + `'添?溃€ 誊锟?powershell.exe' 不是内部或外部命令`。

1. **`install.cmd` 里写了中文 `title`**：cmd 按 GBK 解析 UTF-8 字节，行尾字节吞掉换行，`title` 与下一行 `powershell.exe ...` 拼成一条命令，`chcp 65001` 也被截断成 `11`。修法：`.cmd` 保持**纯 ASCII**（`title Xiaren Installer`）、CRLF、去掉 `chcp`，参数用 `%*` 透传。
2. **自动定位失效**：实测该机 Chrome 的 `Preferences` 里 `extensions.settings` 为 0 条，真正的记录在 **`Secure Preferences`**（`Default` 10 条、`Profile 1` 12 条），且已解压扩展的 `manifest` 字段是 `{}`（`name`／`version` 全空）。原实现只读 `Preferences` 且按 `manifest.name` 过滤 → 永远找不到。修法：两个文件都读；只按 `location = 4` 取 `path`，身份核对改为**回读目录里的 `manifest.json`**；`-Yes`／`-List` 不弹窗，交互模式在无结果时弹 `FolderBrowserDialog`（选错会提示"指定的目录不是虾仁"）；新增 `-Path` 与 `-List`（只看不动，便于远程排障）；已是目标版本的目录直接跳过并说明"无需更新"。
3. 实测该机检测结果：`D:\Documents\ChatGPT\虾秘\extension v0.1.3`（跳过）、`artifacts\虾仁-Chrome-v0.1.1\extension v0.1.1`（待更新）。
4. 测试补到 4 条（新增「记录只在 Secure Preferences 且 manifest 为空」的真实场景），全量 527 项通过；Release 上的一键安装包已替换为修复版（162119 B，`sha256:f6e76e40…`）。

## 0.1.5：修复自动更新的子目录写入（2026-11-13）

### 现象与证据

v0.1.4 的「一键自动更新」在真实安装目录上必然失败，但界面只显示「写入失败，已尝试恢复原文件」，容易被当成网络问题。

- `update.mjs` 把安装包里的相对路径直接传给目录句柄：`dir.getFileHandle('core/backend.mjs', { create: true })`。File System Access 的 `getFileHandle` 只接受单个路径段。
- 用 headless Chrome 156 + OPFS 同接口实测：
  - `getFileHandle('core/backend.mjs')` → `TypeError: Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.`
  - 先 `getDirectoryHandle('core', { create: true })` 再 `getFileHandle('backend.mjs')` → 成功。
- 发布包含 `extension/core/*.mjs`（二十余个）与 `extension/icons/*.png`，因此写入在第一个子目录文件处中断。
- `readFolderFile()` 备份走同一调用并 `catch` 成 `null`，备份集实际为空，回滚分支没有内容可恢复；`removeEntry('core/x.mjs')` 同样非法，新增文件也删不掉。最坏结果是目录里前几个根文件已被换成新版、manifest 仍是旧版。

### 修复

- `updater.mjs` 新增并导出 `pathSegments(name)`：按 `/` 拆段，拒绝空段、`.`、`..`。
- `update.mjs` 新增 `resolveFile()` / `removeFile()`：逐级 `getDirectoryHandle` 下钻，最后由父目录取名；备份、写入、回滚、删除统一走这两个函数。
- 写入顺序改为 `manifest.json` 最后；回滚时本次新增且旧版没有的文件会被真正删除。

### 验证

- `node scripts/check.mjs` 通过；`tests/updater.test.mjs` 12 项通过（新增 `pathSegments` 用例）。
- 全量回归 530 项通过（`--test-concurrency=2`）。
- 在 headless Chrome 内注入与 `update.mjs` 相同的解析逻辑，对 `manifest.json`、`background.mjs`、`core/backend.mjs`、`core/task/queue.mjs`、`icons/shrimp-16.png` 完成写入 → 读回 → 删除，顺序确认 manifest 最后，删除后读取得 `NotFoundError`。

### 未验收与遗留

- 真实扩展页在真实安装目录点一次「自动更新」仍需 0.1.5 发布后验证；v0.1.4 的更新入口本身是坏的，本轮升级只能用 `install.cmd`。
- `paused` 状态仍不阻断更新（只拦 `running`／`pausing`／`stopping`），更新会中断暂停任务的页面上下文，但任务状态与记录保留。
- 默认并发跑全量测试时，`tests/image-backend.test.mjs` 曾在 270 项后长时间 0 CPU 挂起；单独运行 11 项 144 ms 通过，`--test-concurrency=2` 下 530 项 33 s 通过。属并发偶发，未定位到根因。

## v0.1.4：更新检查 403（2026-11-13 17:20）

- 现象：用户重新加载到 0.1.3 后打开「更新虾仁」，页面显示「读取最新发布失败（HTTP 403）」，版本号正常显示 0.1.3。
- 排查：本机 `curl` 打 `api.github.com/.../releases/latest` 返回 200（`x-ratelimit-remaining: 59`），带 `Origin: chrome-extension://…` 同样 200，说明 GitHub 不拦扩展来源；而本机 `curl https://github.com/...` 超时。结论是 0.1.3 恰好把版本检查押在需要匿名配额（60 次/小时/IP）的 API 上，而该机浏览器的出口（代理/VPN 共享 IP）额度被他人耗尽或该域名被代理拦截 → 403。
- 修法（0.1.4）：版本号改由 `https://github.com/<repo>/releases/latest` 的跳转地址解析（`response.url` → `/tag/vX.Y.Z`），下载与校验地址按 tag 约定拼出；`api.github.com` 降为兜底，失败信息带状态码与响应摘要（如 `HTTP 403：API rate limit exceeded`）。`releaseFromTag` 与 API 解析出的 `zipUrl`／`checksumUrl` 已实测完全一致。
- 发布：`v0.1.4`（4 个附件：chrome 包 + sha256、installer 包 + sha256），源码提交 `afe2e6c`。线上包实测 158482 B、`sha256:99408fbe…`，用 0.1.3 的 manifest 走 `readArchive` + `planInstall` 得到 v0.1.4／39 文件／5 项站点权限，即 0.1.3 → 0.1.4 可被接受。
- 遗留：用户当前装的是 0.1.3，其「检查更新」本身是坏的，必须用 installer 升级一次到 0.1.4，之后自动更新才恢复。测试 529 项通过、`check.mjs` 通过。
