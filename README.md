# yomitan 中文学习定制版

仅维护 [suifracti/yomitan](https://github.com/suifracti/yomitan)，不向官方仓库推送或提 PR。

## 下载与加载

请从本仓库 **[Releases](https://github.com/suifracti/yomitan/releases/tag/v2026.10.07-zh-study2)** 下载预构建安装包，不用 Code → Download ZIP（那是需构建的源码）。
两扩展统一包发布于 [asbplayer Releases](https://github.com/suifracti/asbplayer/releases/tag/v2026.10.07-zh-study2)。解压到固定目录，在 Chrome 扩展页启用开发者模式，分别“加载已解压的扩展”选择 `yomitan`、`asbplayer` 文件夹。不要同时启用商店原版，避免重复扫描或录音。

新安装已预设中文界面、AnkiConnect `127.0.0.1:8766`、牌组 `外语::英语语境`、笔记类型 `外语语境卡` 和七个字段；不会迁移或覆盖旧扩展数据。Yomitan 随包提供 ECDICT 英汉词典，首次入门/设置页会自动导入，请等待提示就绪。Chrome 首次加载/授权须人工确认。Anki Desktop 必须运行且安装 AnkiConnect；此包不自动改任意机器的 Anki 数据库。

## 使用

- 文章/字幕：按住 **Shift** 悬停查词；中文释义由内置 ECDICT 提供。
- 视频：asbplayer 使用平台可检测字幕，或拖入自己的 SRT/VTT；不保证任意网站字幕自动可读。
- 视频语境制卡：使用 asbplayer 的制卡入口，或在 Yomitan 加词后用 asbplayer 更新上一张卡片补入音频/截图。普通查词制卡无需额外服务。
- **高级词汇状态标色依赖额外 yomitan-api 本机组件，当前包不启用。** 已预设 Word 字段和目标牌组，但不把配置称为已完成 Anki 复习回流。21 天等“成熟”阈值是软件规则，不是真实掌握。

## 已知问题与本次修复

第一版首次使用暴露两处遗漏：ECDICT 索引校验不通过、asbplayer 入门页没有采用中文预设。`zh-study2` 修复了这两处，并修复在线缓存可能覆盖自定义中文的问题，补齐页面标题及教程确认按钮。第一版已撤回，不继续提供有已知启动问题的包。

- 实际词典 ZIP 的索引及 768739 条词条通过官方 schema；使用官方导入器做样本导入和释义查询。
- asbplayer 中文优先读取随包语言资源，不再由官方在线语言缓存替换；其他语言保持原缓存优先逻辑。
- 构建/静态回归不等于修复版已经在用户 Chrome 完成首次导入或实际制卡；加载后仍需确认。

## 更新与边界

独立公开扩展 key 固定本地版本 ID，与商店版分开；升级复用同一目录和同一 key，不再生成新 key。运行 `tools/check-upstream.sh` 只拉取并查看更新，不自动合并、推送或提交官方 PR。两个自有 fork 均只保留 `main`。后续官方更新适配到自己的 `main`，检查文案键、模板变量、权限与构建后再发布；不创建长期适配/备份分支。

验证记录与构建说明见 `docs/personal-build.md`。构建及静态检查不等于真实浏览器加载、词典首次导入或视频/制卡运行验收。


## 维护与许可证

README 随每次发布更新下载入口、当前功能和未验证项，不保留并列“最终版”。临时计划已完成并移除，必要维护与验收说明集中于 `docs/personal-build.md`。

本项目基于 [yomidevs/yomitan](https://github.com/yomidevs/yomitan)，感谢原作者及所有贡献者；原版权声明和 [许可证](LICENSE) 保持不变。定制代码继续遵守 GPL-3.0。2026-10-07 修改包括中文显示层、英语制卡默认配置和独立扩展标识，不代表官方发布。完整对应源码可通过本仓库提交历史与 Release 源码下载获得。

内置 ECDICT 来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，保留 [MIT 许可证](ext/data/study/ECDICT-LICENSE.txt)。
