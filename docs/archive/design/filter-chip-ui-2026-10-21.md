# 网页筛选胶囊界面合并记录

日期：2026-10-21，Asia/Shanghai。

## 本轮范围

- 参考 `artifacts/recovered-references/2026-10-21/figure-1.png` 的红框位置和 `figure-2.png` 的胶囊形态，将工作台商品类目、社交媒体渠道由下拉框改为动态单选胶囊。
- 商品类目、社媒各占一行；宽屏标签与选项左对齐，选项自动换行；窄屏标签位于选项上方，胶囊至少44px高。
- 保留当前页面选项的值、标签及顺序，不硬编码正式页面的分类或渠道全集；默认、选中、禁用、焦点、键盘方向键均有状态反馈。
- 选择仅修改工作台草稿；实际页面应用仍通过原有“准备名单”链路执行。改变选择撤销旧名单与发送确认；取消应用筛选后禁用胶囊并保留草稿；过期选择明确阻断，不自动换成页面默认值。
- 保留其他对话的默认复选项、移除名称搜索、候选名单选择等最新改动。恢复已锁定名单时使用原来源配置，不由新任务默认项覆盖。

## 改动与清理

正式代码位于 `extension/dashboard.html`、`extension/dashboard.css`、`extension/dashboard.mjs`；设计约定记录于 `DESIGN.md`，行为回归位于 `tests/dashboard.test.mjs`。

修正了合并期间的测试替身：HTML属性解析、旧后台能力、成功响应标志、指定来源与网页来源隔离，以及按实际提交来源模拟筛选准备状态。没有放宽后台或队列的名单校验。

上一轮临时增加的 `tests/fixtures/workbench.html` 筛选桩已撤回。临时视觉预览文件移到 `artifacts/filter-chip-merge-2026-10-21/` 留作可恢复证据，不作为正式测试插件发布。

## 验证

- 工作台82项（含本轮新增禁用、键盘和选项过期测试）通过；并发接入的两项候选名单工作台测试也已在最终全量中通过。
- 筛选、工作台、历史页、模板、达人库交接等相关验证128项通过。该次运行单独排除了当时尚在并发修复的两项候选名单用例；最终全量未排除它们。
- 最新允许的全量运行：474项，473通过、1失败。按项目规则排除 `local-build.test.mjs`，并跳过会生成本地测试插件的CMD启动入口动态检查。
- 剩余失败为 `tests/backend.test.mjs:351`，“首次连接时店铺尚未就绪，登录后可直接准备名单，不需要刷新或轮询读取”：一个达人样本在新的候选缓冲规则下得到 `insufficient`，旧断言仍要求 `ready`。该测试不加载工作台HTML/CSS/JS，留给候选名单需求处理。
- `node scripts/check.mjs` 通过：35个脚本、3段既有夹具脚本，以及Manifest权限和无外部请求检查。此命令只在内存中检查本地版文本，没有生成或安装本地测试插件。

## 浏览器证据

浏览器加载当前正式工作台HTML、CSS和JavaScript，仅Chrome接口返回虚构数据；没有连接真实Shopee页面或执行任务。

- 1280px桌面：无横向溢出；分类和社媒各自单选；取消应用后禁用，重新启用保留Beauty及Shopee Video。
- 390px窄屏：无横向溢出；胶囊最小高度44px；点击Instagram后Shopee Video取消选中；所有胶囊均在视口范围内。
- 检查期间 `panel:collect`、`panel:preview`、`panel:start` 调用次数均为0；截图不代表真实平台筛选或发送验收。

证据目录：`artifacts/filter-chip-merge-2026-10-21/`。包含 `desktop.png`、`mobile390.png`、`mobile390-channels.png`、`browser-check.json`、`filter-ui-tests.log`、`all-tests-final.log`、`check.log`，以及修改前可恢复备份。
