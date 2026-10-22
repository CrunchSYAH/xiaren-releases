# 虾仁 · 印尼 Shopee 达人建联

本仓库公开正式 Chrome 扩展源码、更新脚本及安装包。无外部运行依赖，仅支持印尼 Shopee 卖家站。

## 安装

1. 从 [最新正式版](https://github.com/CrunchSYAH/xiaren-releases/releases/latest) 下载 xiaren-chrome-v版本号.zip。
2. 完整解压到固定目录，在 Chrome 打开 chrome://extensions，开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择包内 extension 文件夹。
4. 点击工具栏虾仁图标打开工作台。不同 Chrome profile 分别加载相同目录，各自的数据独立保存。

## 更新

工作台侧栏点击“检查更新”查看当前版本及最新发布入口。所有店铺任务结束后，双击原安装目录的 update.cmd，输入 UPDATE；脚本从本仓库下载最新版及 SHA256，验证后备份并更新。随后在每个 profile 的 chrome://extensions 点击“重新加载”，重新打开工作台核对版本。不要卸载或改变原扩展目录。

旧版保留在 backups；下载暂存不自动删除。需要回退时先结束所有任务、保留当前文件，再将备份内 extension 及根更新文件恢复到原位置并重新加载。文件备份不包含 Chrome 本地数据，降级不保证数据格式兼容。

## 功能与边界

支持达人广场、排行榜、指定用户或联盟伙伴、候选选择、本地达人库、文字/链接/图片消息、模板及任务记录。Chrome 权限仅 storage、scripting 和 seller.shopee.co.id。请只联系获得适当授权的对象，并遵守平台规则。

真实 Shopee 发送、真实发图及双 profile 实机同时运行尚未完成验收。已提交状态表示受控点击与本地保存，不代表平台接受、送达或已读。

## 源码打包

安装 Node.js 22+，运行 node scripts/package-release.mjs。manifest 与 package.json 版本需一致，脚本生成正式 ZIP 与 SHA256；已有同名包不覆盖。安装包包含 extension、update.cmd、update.ps1、release.json 和 README.txt。

本仓库不包含签名私钥、凭证、店铺数据、内部执行记录或本地测试产物；GitHub 自动生成的 Source code ZIP 不是完整用户安装包，请下载 Release 中的 xiaren-chrome-v版本号.zip。