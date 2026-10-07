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

## zh-study2 首次加载修复

用户截图确认第一版扩展已加载，但 ECDICT 初始化失败、asbplayer 欢迎页为英文；之前的测试未覆盖实际打包词典索引与入门页语言启动。

- ECDICT 离线包移除 `isUpdatable:false`：官方 schema 按字段存在要求更新 URL，而不是按该字段真假；不修改 schema、不虚构自动更新地址。实际 ZIP 全部 768739 条记录通过 schema，官方导入器样本导入及释义查询通过。尚未在用户 Chrome 完成整个词库导入。
- 入门页从已保存的 `language` 读取语言，显式 URL lang 覆盖仍保留，Chrome 界面语言不再覆盖学习预设；页签标题和教程确认按钮补中文。
- 自定义中文优先使用打包资源，禁用只针对 zh_CN 的在线缓存更新；其他语言原缓存优先逻辑保留。以真实源码编译的隔离单元测试复现缓存覆盖并验证修复。
- 本次 Yomitan 8 组相关回归 67 项、Node 文案 5 项通过；asbplayer Python 文案/预设 7 项、生产语言缓存 3 项、既有设置 14 项通过。两源码类型检查通过。
- 本机 AnkiConnect 8766 再次只读确认模型七字段，不写入卡片。扩展权限与固定 key 不变；不操作 Chrome 用户配置、缓存或数据库。
- README 随修复发布更新，第一版已知故障包撤回。用户固定安装目录由构建产物更新，之后需要用户在 Chrome 扩展页手动重新加载两扩展。

## zh-study3 卡片与词典维护

- 设计参考 Migaku 的内容层次、Readlang 的轻量查词与 Language Reactor 的语境入口；未复制付费 AI 或创建第二个复习系统。
- 显示层隔离在 `ext/js/display/study-card.js`、`ext/css/study-card.css`，保留上游 save-note / play-audio / menu / hotkey 和音频选择动作。父弹窗尺寸约束独立为 `study-popup-size.js`，避免内容展开后越出视口；手动拖角后当前查询停止自适应。公共模板新标签在普通 display.css 中默认隐藏，不污染搜索页/汉字的原布局。
- `tools/build_study_dictionary.py` 从官方 `ecdict.csv` 恢复原有字段；原文件 65,933,428 bytes，SHA256 固定在脚本，输出确定性 ZIP。重建用 `python3 tools/build_study_dictionary.py <ecdict.csv> ext/data/study/ecdict.zip --license ext/data/study/ECDICT-LICENSE.txt`。原始 CSV 不另存仓库；源 URL、Git blob 和许可在 ZIP/SOURCE.txt。770611 条包括 1872 条原先因没有中文释义而省略的英文条目。
- 新包标题 `ECDICT 英语学习词典`，独立 V1 成功标记；通过官方导入器完成后才配置/标记。只停用已识别的旧自带包（标题/修订号匹配），不会删除旧 DB；已有停用、新包配置或自定义词典保持用户选择。多配置/改名配置不自动导入。升级须打开设置/入门页，不能只替换 ZIP 声称已更新 IndexedDB。
- 词典无保证完整义项/真实例句，缺字段不填造。Wiktionary 此版仅提供显式在线链接，未打包 WTY 大词库。考试标签/语料排名不是 CEFR 或真实掌握程度。
- `test-localization/render-study-preview.mjs` 使用真实 DisplayGenerator 与打包词条产生隔离预览；`check-study-layout.mjs` 用全新无用户 profile 的 headless 浏览器查浅/深色、展开及窄屏。机器浏览器位置通过 STUDY_CHROMIUM 指定；预览原句为明确演示素材，不是真实用户学习记录。禁止以此替代已安装扩展运行验收。
- 上游适配重点：模板 action/data keys、Display 的 contentUpdate/history 接口、popupFactoryGet/SetFrameSize、结构化词典 schema、默认配置与导入锁；更新时检查这些边界，不改扩展权限或固定 key。
