# 需求5：不同 Chrome profile 双店铺

- 来源：接管“虾仁需求5｜双店铺同时运行”；用户于 2026-10-22 明确两个店铺分别登录不同 Chrome profile，解除原方案的登录形态阻塞。
- 决定：采用 [原方案](../superpowers/plans/2026-10-21-multi-store-parallel.md) 路径 A，每个 profile 加载同一源码的独立扩展实例。项目事实以该方案及操作说明为准，不新增多 workspace、不迁移数据、不改变防重发范围。
- 范围：README 入口、原方案状态、[操作说明](../multi-store-profiles.md) 与本记录；未修改业务代码或测试，不创建分支、提交或推送。
- 当前阶段：部署说明完成；实机双实例非发送验收待执行，无真实发送授权。未操作浏览器或读取登录凭证，未恢复暂停的本地测试插件。
- 代码核查：`background.mjs` 为每份扩展后台创建 backend；`core/backend.mjs` 的队列与 workspace 使用传入 Chrome API 的 `storage.local`；manifest 仅声明 storage/scripting 与印尼卖家站权限。该核查不等于两份实际安装已验收。
- 验证：已重读操作说明与任务记录，核对 README 入口、原方案状态及新增文档目标均存在；无业务代码变更，未运行 Node 行为测试或业务静态检查。未派子代理，模型／档位不适用，不宣称独立测试或审计通过。
- 返工：0/2。下一步按操作说明在两个 profile 执行演练及互不干扰检查，记录实际结果；真实发送另行授权。
