# 虾仁 · 印尼 Shopee 达人建联

本仓库公开正式 Chrome 扩展源码、更新脚本及安装包。无外部运行依赖，仅支持印尼 Shopee 卖家站。

## 安装

1. 从 [最新正式版](https://github.com/CrunchSYAH/xiaren-releases/releases/latest) 下载 xiaren-chrome-v版本号.zip。
2. 完整解压到固定目录，在 Chrome 打开 chrome://extensions，开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择包内 extension 文件夹。
4. 点击工具栏虾仁图标打开工作台。不同 Chrome profile 分别加载相同目录，各自的数据独立保存。

## 更新

工作台侧栏点击“检查更新”进入更新页，页面会读取本仓库最新正式版：

1. 有新版本时点击“自动更新”，扩展自行下载 ZIP 与 SHA256、校验、解压并只替换安装目录下的 extension 文件夹，完成后自动重新加载扩展。
2. 首次自动更新需要点一次“选择文件夹”，选中最初加载的那个 extension 文件夹；之后会记住这个位置。
3. 更新前请在所有店铺结束任务；自动更新会在检测到任务运行时拒绝执行。

自动更新只覆盖 extension 文件夹，不改动 update.cmd、update.ps1、release.json。若你的 Chrome 版本不支持扩展内替换文件，仍可使用手动方式：结束所有店铺任务后，双击原安装目录的 update.cmd 输入 UPDATE，脚本会从本仓库下载最新版及 SHA256，验证后备份并更新，随后在每个 profile 的 chrome://extensions 点击“重新加载”。不要卸载扩展或改变原扩展目录。

旧版保留在安装目录的 backups 文件夹；下载暂存不自动删除。需要回退时先结束所有任务、保留当前文件，再将备份内 extension 及根更新文件恢复到原位置并重新加载。文件备份不包含 Chrome 本地数据，降级不保证数据格式兼容。

## 功能与边界

支持达人广场、排行榜、指定用户或联盟伙伴、候选选择、本地达人库、文字/链接/图片消息、模板及任务记录。Chrome 权限为 storage、scripting、seller.shopee.co.id，以及更新页读取本仓库正式版所需的四个 GitHub 域名（api.github.com、github.com、objects.githubusercontent.com、release-assets.githubusercontent.com）。更新页只发起只读请求，不上传页面、名单或消息内容。请只联系获得适当授权的对象，并遵守平台规则。

真实 Shopee 发送、真实发图及双 profile 实机同时运行尚未完成验收。已提交状态表示受控点击与本地保存，不代表平台接受、送达或已读。

## 源码打包与发布

安装 Node.js 22+，运行 node scripts/package-release.mjs。manifest 与 package.json 版本需一致，脚本生成正式 ZIP 与 SHA256；已有同名包不覆盖。安装包包含 extension、update.cmd、update.ps1、release.json 和 README.txt。

推送到 main 时，.github/workflows/publish-release.yml 会按 extension/manifest.json 的版本号自动打包并发布 v版本号 Release（同名版本已存在则跳过）；也可在 Actions 页手动触发。发布内容包含 xiaren-chrome-v版本号.zip 与其 .sha256。

本仓库不包含签名私钥、凭证、店铺数据、内部执行记录或本地测试产物；GitHub 自动生成的 Source code ZIP 不是完整用户安装包，请下载 Release 中的 xiaren-chrome-v版本号.zip。
