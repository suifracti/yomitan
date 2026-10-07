# 私人定制构建与验收

## 范围
- yomitan 中文显示层、无凭据的英语学习默认预设；只写自己的 fork。
- 不改查词/播放器算法、Anki 调度或声明权限；本机翻译使用已有 optional nativeMessaging，由首次点击授权。保留上游动作与条目索引。
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
新版本实际 Chrome 加载、首次词典完整导入、视频字幕检测、音频截取、真实制卡与复习回流。没有通过受限扩展页面自动化伪造验收。

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
- 新包标题 `ECDICT 英语学习词典`，独立 V1 成功标记；通过官方导入器完成后才配置/标记。只停用已识别的旧自带包（标题/修订号匹配），不会删除旧 DB；已有停用、新包配置或自定义词典保持用户选择。多配置/改名配置不自动导入，但显示状态与显式升级入口。升级须打开设置/入门页，不能只替换 ZIP 声称已更新 IndexedDB。
- 词典无保证完整义项/真实例句，缺字段不填造。Wiktionary 此版仅提供显式在线链接，未打包 WTY 大词库。考试标签/语料排名不是 CEFR 或真实掌握程度。
- `test-localization/render-study-preview.mjs` 使用真实 DisplayGenerator 与打包词条产生隔离预览；`check-study-layout.mjs` 用全新无用户 profile 的 headless 浏览器查浅/深色、展开及窄屏。机器浏览器位置通过 STUDY_CHROMIUM 指定；预览原句为明确演示素材，不是真实用户学习记录。禁止以此替代已安装扩展运行验收。
- 上游适配重点：模板 action/data keys、Display 的 contentUpdate/history 接口、popupFactoryGet/SetFrameSize、结构化词典 schema、默认配置与导入锁；更新时检查这些边界，不改扩展权限或固定 key。

## study4 维护与验收边界

- 本轮设计经用户“做吧”授权，用户另明确允许只测试一句真实翻译。当前只有自有 main，未使用子代理、外部实施代理或上游写操作。
- 视觉：主卡完整、次卡短行，原句只显示一次，可编辑输入；资料合并收起与 POS 标记只改渲染，不改词条含义。为避免鼠标当前条目无法再次收起，Display._focusEntry 在计算滚动位置前触发 `study-entry-focus`，不把 `.entry-current` 当作永远展开的 CSS 条件。
- 词典：旧自动入口的 profile 名称/标记限制是代码事实，不能据此断言用户 DB 的真实原因。每次设置/欢迎页展示安装及当前配置启用状态。显式按钮允许当前目标 profile 升级/启用；操作期间切换/改名立即停止配置写入，不自动删 DB。原 source ZIP 未修改。
- 组件：`local-bridge/study_translator.py`、`install_bridge.py` 和安装 command 均 GPL-3.0-or-later。仅注册自有 `com.suifracti.study_translator` Chrome native host，不改浏览器 Preferences/IndexedDB/扩展加载状态；安装冲突停止。当前 macOS 私有安装位置 `~/Library/Application Support/EnglishStudyTranslator`，权限 0700，认证不在源码/安装 ZIP/Vault。
- 独立 `CODEX_HOME` 是必要隔离：直接加载用户全局 config 的诊断在 thread/turn 前因自定义 MCP transport 不兼容而退出，不能通过仅写 enabled=false 假装隔离。独立 profile 复用本机 auth 文件链接，不读取或导出其值。CLI 自身可能刷新本机认证缓存；升级不得上传这些文件。
- 协议：本机 CLI 0.162.0-alpha.2 实际 schema 的 sandbox 枚举为 `read-only`，不是 `readOnly`。首次真实测试在 thread/start 被拒绝，未调用 turn/start；修正后只运行一轮真实翻译。thread 与 turn 均 environments=[]，ephemeral=true，dynamicTools=[]，空 capability/workspace roots；固定 openai / gpt-6.1-sol、low，不自动模型 fallback。
- config/read 在 turn 前检查 MCP/插件/关键能力已关闭；原句作为 JSON 数据不是指令。单句长度限制、仅两动作、全局单请求锁、100 秒超时、2MB 输出限额、取消/断开终止独立进程组。遇到工具 item 或服务端审批/动态工具 RPC 立即停止，不代理任何工具。文本以 DOM textContent 展示。CLI 更新后应复核 schema 和工具隔离，不把一次成功当长期安全保证。
- 已验证：增强词库 770611 条官方 schema 与导入器样本（8 组 67 项）；Node UI/升级状态 16 项；桥协议/安装 9 项（其中模拟协议明确是 fixture）；相关类型/lint/HTML/CSS；离线浅/深/280px 布局。独立真实 app-server 配置 guard、native host 状态/错误 Origin 拒绝；一句真实 explain 请求约 11.77 秒，返回翻译、语境含义和语法提示。
- 未验证：Chrome 实际权限弹框/点击/新词库查询；真视频字幕、原句截取完整性、发音、截音、制卡、复习回流、其他系统/浏览器；未新增学习卡片。真实调用证据不等于 Chrome 端到端。
- 更新钩子：Display._focusEntry / content events、模板动作、Chrome optional permissions/Native Messaging、配置 profile/index、官方导入器，以及 Codex app-server schema、受限配置及模型权限。上游适配只进入自己的唯一 main，不向官方推送。
- 官方实现参考：[App Server](https://learn.chatgpt.com/docs/app-server)、[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。随包不附 Codex 二进制；需要用户已有安装/登录，使用账号额度，不声称免费离线。

## zh-study5 已批准设计与实施步骤｜2026-10-08

用户批准：紧凑首屏、缓存、去除自带重复词典、模型/推理设置，以及有限语境与本地偏好/主动收藏。主代理独立执行；不新增真实模型调用，不改 Chrome 用户配置，不向上游写入。

1. 扩展行为测试复现旧词典冲突提示与移开丢结果；在后台增加有界本地缓存（100 条/30 天）与同请求在途共享。缓存、模型、推理、偏好/补充语境共同参与键；失焦不取消，明确取消才停止。清除缓存同时阻止在途结果写回。
2. 本机桥增加只读 model/list，并从实际目录验证模型/推理组合；保持隔离、工具拒绝与无重试。偏好采用固定字段；语境为不可信文本，不是自定义系统提示。
3. 添加独立 AI 设置页：模型、受支持推理强度、水平/目标/解释风格、缓存开关与清空、偏好清空、主动收藏管理/导出。正文和 URL 不发给模型，收藏仅用户点击后存本地。
4. 卡片使用速览/词典/用法视图。原句与简短译文优先；完整词典、长 AI 分析不再纵向堆在速览。保留上游动作节点和索引，窄屏仍可读，长原句允许局部展开。
5. 补充 WTY 英英包，保留 CC BY-SA/GFDL 数据许可、出处及对应转换器 MIT 说明；当前配置仅停用已识别旧 ECDICT，不删数据库或自定义词典。已导入用户停用状态不反复覆盖；新补充词典显式入口。
6. 文章从既有本地句子扫描范围提取相邻句，默认不发送；视频使用已有字幕输入，可补充语境，记录可用时间定位，不下载视频/自动转录。
7. 相关 Node/Python/类型和格式检查、离线实际生成器首屏布局检查、构建与固定目录摘要核对。发布仅自有 main/预发布；用户手动重载，真实 Chrome/字幕流程单独确认。

模块：ext/js/study/{study-data,study-service,study-client}.js；ext/js/pages/study-settings-main.js 与 study-settings.html/css；现有 study-card/translation；local-bridge/study_translator.py；bundled-dictionary 与句子生成器。

### study5 当前实现与验证

- 已实现设计所列卡片视图、后台共享/持久缓存、有限偏好、主动收藏、模型/推理 UI、文章有限相邻句与视频播放位置。旧包一次性停用只匹配标题/修订号的旧 ECDICT；未来用户重新启用重复项会出现明确修复按钮，不反复覆盖个人选择。
- 本机桥已更新；真实 config guard 与 model/list 返回 7 个模型，默认 gpt-6.1-sol / low 组合存在。没有 thread/start 或 turn/start，**本轮真实生成 0 次**。其他模型实际账号访问和质量未测。上一版获准的一句测试与用户截图保留历史事实，不能代替本版验收。
- Node 22 项：缓存恢复/同句复用/在途共享/明确取消/清空竞态/收藏容量保留/视频位置/设置能力/旧词典冲突；Python 11 项：协议、受限配置、模型验证及安装幂等。实际 ECDICT 全 bank schema/样本导入与 WTY 原包 SHA/真实例句样本/官方导入器通过（Vitest 4 项）。修改的生产 JS、类型、CSS/HTML 检查通过。
- 使用实际 DisplayGenerator 与词条数据的离线预览：400px 宽首屏约 524px 高，译文和操作底边约 461px，无须滚动；浅/深/窄屏不横向溢出。这是隔离离线布局，不是用户 Chrome 新版验收；长句全文在用法视图可查看。
- WTY revision 2026.10.04，原 ZIP 107871321 bytes / bcccdce0047917db42c55e8221eff22c1477794cbcd571ddc49551cf26254fbf；两 part 无损组合，导入前检查摘要。数据 CC BY-SA 4.0、代码 GPL；保留原 index、样式、许可和贡献者出处，不打包来源不明商业词典。
- Chrome Native Messaging 端口归后台持有，视图销毁不再取消。重载/关闭浏览器仍可能中断在途请求；已完成且成功存储的缓存可跨重启恢复。已发生账号消耗不能退款。
- 构建/发布的实际 SHA 与固定加载目录摘要由 BUILD-INFO/SHA256SUMS 维护。用户只需重新加载 Yomitan、刷新网页、打开一次设置等两份词典就绪；不用删除/重装，也不用重新配置 asbplayer。
