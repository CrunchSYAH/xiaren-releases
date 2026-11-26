# 指定联盟伙伴身份解析交接

status: ready

负责范围：仅 affiliate-resolver 命名的独立模块、测试、脱敏证据与本报告；不修改共享业务文件。

目标：核实 affiliate ID → Shopee 用户 ID → 当前店铺聊天收件人的真实链路。现有 specified 广场行筛选不构成联盟伙伴解析；不按数字相等或同名推断映射。

结论：已找到并实测官方详情页的可靠身份映射及聊天入口，独立模块可接入；本报告的 ready 仅表示解析模块完成，不表示共享发送链已接入或真实发送已验收。

## 实施计划（writing-plans / test-driven-development）

- [x] 核对所有权和广场既有行为，验证官方详情入口与身份链。
- [x] 先写 affiliate-resolver 独立测试，覆盖精确身份、顺序、冲突、过期页面及聊天打开保护；确认空实现时13项失败，后续保护测试也先确认失败。
- [x] 实现纯解析模块及可序列化 MAIN 页面函数；仅白名单读出与受控打开聊天，无发送、外部请求或业务存储。
- [x] 运行窄测试及语法检查，在真实详情页执行实际模块的非发送核查，关闭自建页。
- [x] 重读改动并完成独立只读代码复核，保存脱敏证据、接口和集成边界。

约束：不操作现有任务，不发送、不上传附件，不保存原始身份、正文、凭证；只操作自建后台页并在结束时关闭。

## 已验证事实

- 真实广场行同一组件记录包含 `affiliateId` 和 `shopeeUserId`，本次样本两值不同，行键后缀等于 affiliate ID；该行聊天的编辑器 `buyerId`、会话 `to_id` 都等于 Shopee 用户 ID，店铺也一致。
- 广场搜索框为 `Search by affiliate name`，实际请求字段 `affiliate_name`。将已知 affiliate ID 当名字搜索，正常业务响应0条；用同一人的已知 username 搜索得到1条且精确 affiliate ID 一致。不能声称这个搜索框支持数字 ID 解析。
- 点击真实广场行产生官方 `/portal/web-seller-affiliate/kol_marketplace/detail`，参数含 `affiliate_id`。删除可选的类目和前页参数后，只保留 `affiliate_id` 重新加载仍能读取资料及聊天入口。
- 详情已加载时，当前 UserInfo 组件的 `detail.profile.affiliateId` 等于查询 ID，`profile.shopeeUserId` 等于组件 `shopeeUserId`，组件店铺等于当前登录店铺。资料卡内“Chat with Affiliate”打开聊天后，`buyerId`／`to_id`／店铺再次精确匹配；未依赖同名。
- Manage Affiliates 当前为空；Mass Upload 弹窗说明模板填写 affiliate names、CSV最多500人。只打开弹窗，未上传或添加伙伴，因此不提供此页数字映射适配。

原插件证据：2026-10-19 已观察指定模式因会员禁用，见 `docs/reference-plugin-study-2026-10-19.md`。本次自建详情页仍注入悬浮入口，但没有成功展开配置控件，故未重新验证其指定模式，不据此推断原插件如何解析。

## 导出接口

纯模块 `extension/core/affiliate-resolver.mjs`：

- `normalizeAffiliateIds(values)`：只接受1—200个去重后的正整数字符串（无前导零，最长40位），保留首次出现顺序；拒绝数字、空值和稀疏项，避免大整数精度丢失。affiliate ID 与 Shopee 用户 ID 始终分开。
- `affiliateDetailUrl(affiliateId)`：生成已验证的印尼官方详情 URL，仅含 `affiliate_id`，不接收任意站点或拼接参数。
- `resolveAffiliateIdentities(ids, observations, { shopId })`：输入本模块从当前账号页面获得的观察结果，按请求顺序返回 `{ status:'resolved'|'blocked', identities, unresolved }`。identity 包含 `affiliateId, shopeeUserId, name, username, shopId, documentEpoch, path, evidence`；缺失为 `not-observed`、同一 affiliate 多个用户为 `conflicting-mapping`、多个 affiliate 指向同一收件人为 `duplicate-recipient`。任一阻塞都不能启动整份名单，不补其他人。此函数不验证任意外部JSON真实性；调用方必须保证观察结果来自其专用标签页 MAIN 注入结果。
- `matchesAffiliateSnapshot(expected, page, { requireChat:false })`：`expected` 必须有 `affiliateId, shopeeUserId, shopId, documentEpoch`；核对官方详情、加载状态、资料映射和聊天入口。填入／授权前加 `requireChat:true`，要求当前编辑器身份、会话及店铺匹配。它是后台结果校验，不能代替最终 MAIN 同步核对。

页面模块 `extension/affiliate-resolver-page.mjs`：

- `affiliateResolverPage(expected=null, action='inspect')`：完全自包含，可直接作为 `chrome.scripting.executeScript({ world:'MAIN', func:affiliateResolverPage, args:[expected, action], target:{tabId} })` 的函数。返回 `{ origin,path,documentEpoch,shop,status,reason,affiliate,chat,blocked }`；仅输出白名单身份／状态，不返回联系方式、聊天正文、历史、原始资料或凭证。
- `inspect` 只读；未加载、未知／错店铺、验证码、重复查询 ID、非当前 React 分支、profile／prop／query 不一致均 blocked。`expected` 非空时同时核对锁定映射和当前文档。`affiliate.chatAvailable` 为独立布尔值，profile verified 本身不表示可聊天。
- `open-chat` 要求完整 expected 锁、资料卡内唯一可用聊天按钮，在同一同步执行中核对后点击；返回 `action.performed`。所有挂载聊天编辑器（含隐藏的）必须正文为空、附件和回复数明确为0，否则不切换。它只打开聊天，不点击发送；点击抛错由调用方处理为失败／未知，不自动重试。
- `install` 在当前 MAIN 文档注册 `window.__creatorAffiliateResolverPage` 为同一同步函数并返回 `installed:true`。最终发送函数可在自己的同步边界调用 `window.__creatorAffiliateResolverPage(expected)`，要求 `status==='verified'`、affiliate完整锁及 chat身份一致；缺失函数、异常或任何不一致均拒绝。导航后必须重新注入；此只读函数不消费发送令牌或执行发送。

## 集成位置与不可绕过的约束

1. 后台来源规范化：新增明确的 affiliate ID 来源／字段；保留旧 `specified` 仅表示已加载 Shopee 用户 ID。逐个通过官方详情路由核对，不把输入当 Shopee 用户 ID，不用 username/name 推断映射，不替换为相似记录。
2. 准备阶段：绑定当前店铺，用专用页导航至 `affiliateDetailUrl`，等待页面完成加载后有限重试只读 inspect，收集所有核实观察并调用纯解析。未知、无权限、无入口、限流、找不到或映射冲突要显示原因并阻止整份启动。保留用户输入顺序；名单中的实际队列收件人仍是已核实 `shopeeUserId`，另存 `affiliateId` 供后续复核和库来源使用。
3. 执行阶段：再次导航对应详情，重新读取当前 `documentEpoch` 后锁定 `affiliateId/shopeeUserId/shopId/documentEpoch`（准备页的 epoch 不得跨导航沿用），受控 open-chat 后重读核对。填入、图片准备、每条授权和最终点击都要核对完整身份；不能因解析成功移除旧有草稿、会话、图片、令牌和迟到回包保护。
4. 最终 MAIN 点击：此页面没有广场挂载行，不能伪造广场名单／行键绕过旧 `safeRoster`。由共享 `page-snapshot.mjs` 增加详情来源的显式核对分支，在原有最终受控点击的同一同步调用内使用已安装解析器；紧邻点击前核对当前详情、整份锁定配置中的当前目标、store、editor与conversation，保留原草稿、图片File引用、单次消费和提交先落盘规则。不得先异步读解析结果、下一次注入就直接点击。
5. 来源切换／导航与暂停恢复：沿用专用标签页、停止旧执行器、当前店铺和文档绑定、部分提交不重发；未完成全部接线及正式回归前不在UI声称可发送。现有广场路径和发送流程不受本模块改动影响。

排行榜或库若要复用：用记录中的真实 affiliate ID 打开此详情页并精确复核。不要将排行榜数字字段在未经证据核实时改名为 affiliate ID；库记录也不能仅凭过去 verified 状态直接发送。

## 验证结果与证据

- `node --test tests/affiliate-resolver.test.mjs`：16/16通过；覆盖输入、顺序、同名不匹配、冲突映射／收件人去重、上下文与文档、当前React分支、卡片按钮归属、隐藏草稿及附件／回复、聊天身份和安装后同步检查。
- `node scripts/check.mjs`：语法、Manifest权限和无外部请求检查通过。此命令现有实现会在内存中生成本地测试版源码作语法检查，本次未生成／安装本地测试插件、未运行 local-build 测试。
- 实际最终模块在真实详情页运行：`status=verified`，资料／店铺／聊天一致，draftEmpty=true、mediaCount=0、replyCount=0；完整锁 open-chat=true，错误收件人或旧文档 open-chat=false，安装的同步检查再次 verified。
- 独立只读复核：发现并修正全页按钮误归属、隐藏草稿、稀疏数组问题，回归均通过，最新复核没有剩余可行动缺陷。全文和imports已重读。
- 脱敏一手证据：`docs/affiliate-resolver-evidence-2026-10-20.json`。只保存路由／字段名／条数／布尔比较；没有保存原始身份、正文、联系方式、凭证或完整页面。唯一自建研究页已关闭并再次核实不存在。

本轮仅运行独立窄测试与静态检查；正式全量行为测试、共享来源接线／暂停恢复／图片／逐条授权回归由排行榜与集成对话负责。真实样本只有1个，不代表任意ID或账号都可聊天；原站组件改版、权限、账号可见性、长期限流未验证。真实发送、平台接受／送达／已读均未验收。
