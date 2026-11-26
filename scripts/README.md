# scripts 索引

按用途分四组。入口命令都由 `package.json` 的 `scripts` 或下文标注的 `node <路径>` 触发。

## 一、日常校验（发版前必跑）

| 脚本 | 用途 |
| --- | --- |
| `check.mjs` | 扩展一致性总闸：语法、Manifest 权限白名单、外部请求禁令、夹具脚本。`npm run check` |
| `preview.mjs` | 本地预览服务，只监听 127.0.0.1:4177，供夹具页面与工作台调试。`npm run preview` |

## 二、打包与分发

| 脚本 | 用途 |
| --- | --- |
| `package-release.mjs` | 打官方发布包 `xiaren-chrome-v<版本>.zip` + SHA256 |
| `package-installer.mjs` | 打一键安装包 `xiaren-installer-v<版本>.zip`（含 `install.cmd`/`install.ps1`） |
| `zip-utils.mjs` | 进程内 ZIP 读写（条目统一正斜杠），供上面两个脚本共用 |

产物统一落在 `artifacts/`（已 gitignore）。发布的权威副本在 GitHub Releases，
本地历史归档见 `releases/`。

## 三、真实页面录制（`tests/fixtures/recorded/` 的来源）

站点改版、需要重新采集样本时才用，平时不必跑。采集结果**不覆盖旧样本**，先归档。

| 脚本 | 用途 |
| --- | --- |
| `record-real-page.mjs` | 录制入口：驱动已连接 Chrome 抓取列表页/聊天页的真实 DOM 与计算样式 |
| `capture-recorded-page.mjs` | 单页抓取实现，被录制入口调用 |
| `recorded-format.mjs` | 录制文件的格式定义，同时被 `tests/recorded.test.mjs` 引用 |
| `build-recorded-manifest.mjs` | 生成/更新样本的 `manifest.json`（来源、摘要、证据缺口） |
| `audit-recorded-privacy.mjs` | 脱敏审计：确认样本里不含账号、真实姓名、资源地址与凭证 |
| `verify-recorded-page.mjs` | 离线重放校验：用替身 Chrome API 跑一遍页面执行链。需先启动 preview 与 CDP Proxy |

**边界**：这些脚本产出的是"本地替身样本"，通过它们不代表真实平台可用。

## 四、历史工具

| 脚本 | 状态 |
| --- | --- |
| `verify-dashboard.mjs` | 2026-10-16 的一次性界面冒烟检查，结果写 `artifacts/dashboard-verification.json`。保留作参考，不在验收集内 |
| `build-local-test.mjs` | 生成本机专用测试插件到 `artifacts/extension-local-test/`。**该功能已暂停**，且其文件清单未跟进 `dashboard.mjs` 新增的 `core/task-duration.mjs` 依赖，直接跑 `tests/local-build.test.mjs` 会有 2 条失败（已知，勿计入回归） |
