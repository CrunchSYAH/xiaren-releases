# Task 3: 本地扩展操作面板

预期输出：可直接加载的中文 Chrome 扩展工作台，完整连接名单选择、预览、启动、暂停/停止/恢复、人工核对、拒绝名单与结果导出。

只拥有 `extension/dashboard.html`、`extension/dashboard.mjs`、`extension/dashboard.css`、`.superpowers/sdd/task-3-report.md`。不要改其他文件，不提交/建分支，不联网/操作真实浏览器，不读取凭证。工作目录 D:\Documents\ChatGPT\虾秘。用户已选择自动队列并回复继续开发，尚未授权真实发送。

使用 frontend-design 技能建立符合工具用途的视觉并自审。中文为默认文案；界面应清晰显示演练/真实模式、店铺、页面连接、当前处理项与错误原因。默认演练、名单默认不选、模板默认空，避免误发。无依赖、无CDN、不加图像资源或远程字体。可以用纯SVG小图标。UI变化不写镜像实现的低价值测试；主代理负责浏览器集成验收。

## 视觉

浅灰蓝底 #F3F6FA、深蓝导航 #173453、白色工作区、Shopee 橙 #E9492D 主操作、绿 #217461 成功；中文用 Microsoft YaHei UI 等系统字体，数字可 Segoe UI。工具名“虾秘 · 印尼达人建联”，清楚说明独立自用版。左侧窄栏显示连接与操作，主区上方任务设置（模板、秒间隔、本次上限、模式），下方宽名单列表与右侧消息预览，底部/侧边队列进度。响应式、键盘focus、空态有操作指引，避免所有内容堆成相同卡片。

## 与后台交互

统一 `await chrome.runtime.sendMessage({type,...})`，响应为 `{ok:true,...payload}` 或 `{ok:false,error:'中文说明'}`；若 chrome.runtime 不存在，显示“请从 Chrome 扩展打开工作台”，禁用操作，不请求远程服务。

所有 panel 响应中的 state/workspace 可用时更新界面。常规 `panel:get` 每 1.5 秒刷新，不覆盖用户输入、勾选或正在看的人。按数据修订差异更新 DOM，避免每秒整个表格重建打断用户操作。

workspace：`{tabId,pageId,shop:{id,name}|null,creators:[{id,name,username,rowKey,chatAvailable}],error:string|null}`，没连接时 null。state 见 `extension/core/queue.mjs`，可以读此源码获知准确字段。

- `panel:get` → `{state,workspace}`。
- `panel:open` → `{state,workspace}`：打开工具专用 Shopee 页；页面尚未就绪时说明等待。
- `panel:refresh` → `{state,workspace}`：读取专用页当前可见名单。不可运行中修改配置；可让用户在专用页面先手动筛选再刷新。
- `panel:preview {config}` → `{state,workspace,preview:{items,sendableCount,skippedCount},previewToken}`。
- `panel:start {config,previewToken}` → `{state,workspace}`。
- `panel:pause`、`panel:stop`、`panel:resume` → `{state,workspace}`。
- `panel:resolve {itemId,resolution:'sent'|'skip'}` → `{state,workspace}`。
- `panel:deny {shopId,creatorId,name,blocked:boolean}` → `{state,workspace}`。
- `panel:finish` → `{state,workspace}`：明确结束 paused/stopped 任务（已核对且无活跃项），剩余项记跳过，以便建立新任务；不清除历史。

config：`{shop:{id,name},creators:[{id,name}],template,intervalSeconds:Number,limit:Number,mode:'dry-run'|'send'}`。变量只支持 `{{name}}`；textarea maxlength=2000，名单上限200。间隔和上限必须用户填正数，间隔无所谓安全值，不预填承诺安全的数字；可 placeholder 30 和 10，但默认value空。模板中显示预览选中达人，逐项可切换。

预览结果的 item：`{id,name,text,status,reason,authorized}`。更改任何配置/名单/拒绝名单/连接刷新需使本地 previewToken 失效并禁用启动，直到再次预览。启动真实发送前需用户勾选“已核对店铺、名单和逐人消息，同意本次自动发送”，配置变化取消勾选。它是产品正常启动确认，不是代理此时的真实发送授权。

task：`{id,sessionId,binding,config,status,items,nextAt,reason,createdAt,updatedAt}`，status `running|pausing|paused|stopping|stopped|completed`；item 状态 `pending|preparing|prepared|sending|sent|rehearsed|skipped|failed|uncertain`。按中文转换，不向用户暴露英文状态机术语。`uncertain` 显示两个按钮“确认已发送”（演练则“确认已演练”）、“跳过并保留防重发记录”。没有核对完不能恢复/结束。`failed` 明确恢复时跳过该项、不自动重试。

running/pausing/stopping 期间禁用任务配置、名单更改及重新预览/启动；暂停后只提供继续/结束本任务，修改模板需结束本任务再预览新任务。暂停/停止不是完成，展示“结束本任务”入口，后台 finish 会保留历史。

拒绝名单需支持当前列表加入/解除，并显示该店铺已不在当前列表中的拒绝记录及解除按钮。历史去重无需删除入口。导出使用 Blob + a.download（不用 downloads 权限），导出 state.task 和本地拒绝记录即可，纯本地；不得把成功演练写成真实已发送。

报告到 .superpowers/sdd/task-3-report.md，包含文件、自审、实际语法检查。不要宣称已浏览器验证或真实发送通过，主代理负责。
