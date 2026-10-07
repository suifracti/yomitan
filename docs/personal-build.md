# 私人定制构建与验收

## 范围
- yomitan 中文显示层、无凭据的英语学习默认预设；只写自己的 fork。
- 不改查词/播放器算法、Anki 调度、扩展权限；除预设与首次词典初始化外保留上游逻辑。
- 独立 public key 隔离商店版，私钥未保存/上传；此 key 不是任何账号凭据。

## 工具链
- 本机 Node 24.18.0。asbplayer 上游声明 Node 24.21.0/pnpm 11.27.0；本次使用 pnpm 11.27.0，Node 24.18.0 构建通过，但并非完全相同版本。
- Yomitan 使用 npm ci --ignore-scripts 与 npm run build:libs；asbplayer 使用冻结 pnpm lockfile。未自动升级依赖。

## 测试
- Yomitan：五项本地回归、上游 schema 验证及既有配置保留测试、修改文件 ESLint 与 TypeScript 检查。
- asbplayer：四项中文/字段预设检查、全语言键一致性与既有设置提供器 14 项回归。
- Anki：8766 只读 version=6；目标牌组与七字段已核对；两个新扩展 Origin 请求被当前接口接受。未新增测试学习卡片。
- Chromium 构建通过；最终文件与 SHA256 以 Release 的 BUILD-INFO.json 为准。

## 未实测
实际 Chrome 加载、首次 77 万词条导入、视频字幕检测、音频截取、真实制卡与复习回流。没有通过受限扩展页面自动化伪造验收。

## 上游安全边界
Yomitan npm 全依赖审计报告 52 项（含开发工具）；omit=dev 检查为 0 项。该审计不保证构建链/最终扩展无漏洞；不执行 audit fix --force 来掩盖风险。

## 更新
不自动定时更新；用户要求适配时先只读 fetch 官方更新，再在我们唯一的 `main` 审查合并与适配。不向官方写入；不保留额外长期分支。Yomitan 将翻译集中于 ext/data/zh-cn-ui.json；新增或改名文案需检查。 完成测试及构建后才发布到自己的 fork，不向官方提 PR。

README 每次发布可更新，保留原作者出处、许可证、修改说明与对应源码入口。仅清理本次完成的临时计划、重复介绍和自有 fork 的多余分支；不删除上游运行代码、测试或构建依赖。

维护提交使用 `suifracti@gmail.com`，两个本地仓库已设定 `user.email`；作者与提交者邮箱均须在提交前核对。官方历史作者不修改；2026-10-07 此设置之前已推送的定制提交尚保留旧邮箱，未擅自重写历史。
