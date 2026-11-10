# 外语学习系统｜项目记忆

规则见 [AGENTS](../AGENTS.md)。任务/结果沿用 [youtube-study-wiring](youtube-study-wiring.md)，产品范围沿用 [roadmap-2026-10](roadmap-2026-10.md)，不要另建第二份当前任务表。

## 按用户说法找经验

先读此索引，再读命中的条目正文与实际实现；索引只帮助定位，不替代原因和证据。无匹配时再查项目任务源、相关差异和历史，不能因此断言以前没做过。

| 用户说法或本次触及范围 | 到哪里找 |
|---|---|
| B站多P、第二P字幕错了；改选集/字幕来源/缓存 | L-001；ext/js/study/web-video-site.js 的 bilibiliSources |
| 记笔记、制卡、保存/同步、人工卡片和排程；只在Anki、重建后记录消失、点需处理没反应 | L-002；study_sync.orphan_action、test_study_repair.py；docs/youtube-study-wiring.md |
| YouTube HTTP 200 但字幕空；截取有内容却没载入；capture / refetch | L-003；youtube-caption-capture.js、YoutubeReader.start / _load |
| TED 自动选了库尔德语；英语轨消失；一批字幕预取 | L-004；WebVideoSite.remember / sources、languageHint、guessLanguage |
| TED 广告后没有字幕行或当前句；播放器换 video | L-005；YoutubeReader.start / _rebindVideo |
| 刷新后字幕语言丢了；找不到继续按钮；进度/偏移互相覆盖 | L-006；YoutubeReader._loadWeb / _restoreVideoState、WebVideoSite.load、subtitle-prefs.js |
| 视频已记词点制卡后丢来源/时间；重开后旧解释变空；恢复已保存记录 | L-007；openStudyRecord、study-data.createResumeUrl、search-main.js / study-translation.js |
| 换视频后出现上一段字幕；异步保存后串会话 | L-008；YoutubeReader._load / _loadWeb、_generation |

## 默认自动执行：不等用户提醒

日常记录与联动继承 Vault 根 `AGENTS.md` 的“2 项目记录”，全周期复盘见“5.1 全周期复盘与覆盖”。通过[仓库 AGENTS](../AGENTS.md)定位总规则和本项目主源；本页只维护场景索引、具体经验与已有覆盖点。

## 已有资产与逻辑定位

网页字幕来源从 `ext/js/study/web-video-site.js` 查起；共用翻译选项在 `ext/js/study/translation-engines.js`。词卡、笔记与 Anki 保存行为沿现行交接定位，不因“有一个按钮”就推断正式持久化链已通过。部署沿 `dev/sync-local.py`，不能绕过拒绝。旧 App/asbplayer 相关资料只作为沿革，不重新开发已放弃路线。

| 触发与入口 | 处理与状态位置 | 输出与身份 |
|---|---|---|
| YouTube timedtext 响应 → 动态 MAIN 脚本 | study-service.js 注册；youtube-caption-capture.js 发固定消息；reader 按视频/轨道保留最多 10 份内存正文 | _load → SubtitleSession；DOM captionSource / captionTrack 表示成功会话来源，不是持久缓存 |
| 网页视频字幕 → WebVideoSite.sources | B站按 bvid/p/cid 查来源；其他来源复用 TextTrack 或已发现的字幕 URL、fetchSubtitle 与 parseSubtitles | 共用阅读器、原文与时间；B站 p 属于来源身份，不按第一个 cid 猜选集 |
| 播放器替换视频元素 → _rebindVideo | 取 site.video，移除旧 timeupdate 后绑定新元素；现行检查周期 1500 ms | 沿用同一字幕会话，更新覆盖层与侧栏当前句 |

## L-001 B站多P：有字幕不等于当前选集正确

触发：修改站点字幕发现、选集、URL 解析或来源缓存。

证据：[716e48a](https://github.com/suifracti/yomitan/commit/716e48aefb1e1546216c4f4c8d485ec3012b8df3) 的真实 diff。`bilibiliSources()` 先按 bvid 查询 pagelist；旧实现固定 `pages.data[0].cid`，所以第二 P 仍选第一 P。修复按 URL 的 p（默认1）选对应 cid，再查该 cid 的字幕列表。不是登录状态问题，也不需要重造字幕解析器。

保留：默认第一P与显式第二P要对应正在播放内容；缺 cid 返回无可用来源，不猜内容。B站即使 textTracks 和字幕资源请求为空，仍可能由播放器 DOM 绘字；现行来源链复用 pagelist → 当前 cid 的 wbi/v2 → fetchSubtitle → B站 JSON 解析（25f5f7fb、716e48ae）。字幕文件先匿名请求，失败才带凭据，保留现有下载行为；不要因旧的一次未登录失败就断言登录是唯一根因。

实际结果：[第2P可见面板验收](youtube-study-wiring.md#b-站第-2-p-最后验收2026-10-24gpt-接续)，记录提交 f496f452。2026-10-24 主 Chrome 的 BV1xWnM6HEUU?p=2 列出英语/中文两轨，默认英语 240 句，首句 `Hello my wonderful English learners!`，0:00；该次没有另测中文切轨或保存制卡。2026-11-11 已读该段正文与对应实现，复用其有日期的实机证据，本轮没有重跑。

## L-002 记笔记、选择制卡与真实同步是不同动作

依据：既有 Vault 阶段反馈和当前项目保护约定。笔记保存不能隐式覆盖用户手工卡片或复习排程；同词不同原句/来源不能误归属。临时 Vault/FakeAnki、模拟字幕与真实 Profile 分层记录，图片或视频网址不能代替原声音频证据。

下次：先查当前产品规格和保存链，而不是重新增加一个同步系统。保留具体版本、对象 ID 与冲突/删除语义；缺真实证据写未知。此前仅为要求与历史证据边界，2026-11-11以下新增临时链证据不代表正式库通过。

“只在Anki／重建笔记／恢复后记录消失”：orphan_action 原先每次无条件追加同一张卡，若上次回复丢失而缓存孤卡行仍在，再点恢复会重复同一card ID；同步区拒读重复卡，增量索引因此看不到刚恢复的记录。现按noteId保留单一关联，重试不重复追加；卡型用原有 study_kind:: 标签，保留原来无标签时的语境卡行为，不把所有新恢复卡硬写成context。test_study_repair原有连贯场景扩展了重复恢复与meaning卡型断言，两个缺口均先失败再通过，且确认无Anki写入/删除/移动/排程。复用旧库和标签，没有新增协议、配置或同步器；对应交接“2026-11-11 重建笔记的重试与原卡型”。

“卡已恢复却一直提示被删除”：自动同步原先只在记录还不是missing时比较ID是否消失；处于missing的记录即使同一Anki ID重新出现也不会核对，且mod未变时edited:1无法补触发。现复用每轮已有的带学习标签ID清单，关联ID缺失状态与记录missing状态不一致时才reconcile；恢复后安静轮次不再重复核对。新增临时删除→同ID/同mod返回→清除missing→安静一轮用例通过，原2000卡notesInfo只读当日编辑与候选用例也通过。没有实测Anki撤销按钮，不把替身情景冒充正式库行为；未新增扫描或改变排程。

“点需处理没反应／切分类后空白”：学习库loadPage在loading时直接return，分类按钮先改category，因此前一次列表慢响应时会丢失新分类查询。现仅记住一个待刷新请求，旧列表返回后不提交过期快照，完成后读取当前所选分类；不加计时器或并发拉取。study-library-page.test.js新增慢列表期间切pending的DOM场景通过，原收藏/同步/冲突选择场景也通过；旧用例最初把已有ankiToday调用算进固定四次流程，现只从该断言排除今日条，保留原四步与载荷断言。JS及测试lint均0，未实测Chrome。

## L-003 YouTube：HTTP 200、非空截取与实际用上是三件事

触发：修改 timedtext 获取、默认/手动选轨、截取缓存，或复现“播放器有字幕，学习栏却是空”。

可用结论：保留已采用的截取方案和重发路径，不重新进行探针装卸。d58079bc 动态注册 MAIN/document_start 脚本，只复制 timedtext 的 fetch/文本 XHR 正文；ready 消息可索取脚本最近一份非空响应。reader 另按本视频的 lang|kind|tlang 存最多 10 份，换视频清空。b424fa2b 的顺序为当前轨道截取 → 无 tlang 的英语截取 → 原重发；会话按实际采用的轨道建立。两层缓存职责不同，不把 MAIN 的“最近一份”说成它也保留了全部轨道。

证据与限制：[切回英语后 capture 命中](youtube-study-wiring.md#2026-10-23-影片-2-切回英语后的补充验收capture-命中)，记录提交 359756ae。2026-10-23 影片 XqS7kIWMIDE 在用户选回英语并刷新后载入 444 句，首句 `This quote has been living in my head rent free for the past year.`，0:00；DOM data-caption-source=capture、data-caption-track=en-US|。影片 arj7oStGLkU 英语 168 句、法语翻译 169/169 的成功记录是 refetch，不能拼接成两个视频或所有轨道截取通过。

原因边界：之前 739241 字符的缓存回复只证明有非空内容；没有核到那份的 v/轨道/请求发起者，不能认定轨道不匹配是唯一根因。另一个双语字幕扩展画出的内容不是原生播放器或本产品成功证据。阿拉伯语状态的失败仍保留；LOGIN_REQUIRED 下的手动 SRT 导入只证明导入。adb01af3 的空正文提示已改为选择英语再刷新。下次先读成功会话的两个 DOM 属性；不要仅凭 HTTP 状态、截图或缓存长度宣布获取修复。测试位置 test/study-caption-capture.test.js；本轮只读，未重跑。

## L-004 TED 选错语言：英语预取文件被有限窗口挤掉

触发：页面预取大量字幕、英语来源消失、自动载入库尔德语或未知语言。

确定原因及方案：[TED 英语轨定位过程](youtube-study-wiring.md#ted-的英语播放器轨为什么没被选上同日复查)。页面一次预取 64 轨，英语在前，旧 remember 窗口只留 30 条；挂载时最新的 ckb 仍在而英语已丢失。英语 TextTrack 在隐藏视频元素上，也不会被当时可见主视频的来源枚举读到。延长 3 秒读取等待解决不了来源已丢的问题。临时 300 条对照曾成功，但最终提交 d3c0132b 将窗口设为 **100 条**；不要把实验值 300 当生产参数。

保留：de635ac3 的 languageHint 从 /subtitles/en/ 等路径识别语言；guessLanguage 不再把未知文字一律叫英语，会话未知语言用 und。保留来源选择、下载和解析链，不扩大为新识别系统。后续 2026-10-24 记录的 TED-1 英语载入为 271 句；`Good morning. How are you?` / 0:05 来自此前 300 条窗口的对照记录，不另称修复后的首句重测。这与下一条“有数据但播放不出行”是两个根因。本轮核 diff 和现行实现，未重新访问 TED。

## L-005 TED 广告后字幕不走：旧 video 仍连接不代表还在播放

触发：已载入字幕但覆盖层无行、侧栏无当前句；广告与正片使用不同 video，媒体 key 没变。

确定原因及方案：[广告元素绑定案例](youtube-study-wiring.md#ted-播放时没有字幕行阅读器绑在了广告元素上2026-10-24)。会话在广告期绑到广告元素；广告结束后它缩成 0×0 但仍在 DOM，旧 isConnected 守卫阻止改绑，watch 也不因相同媒体 key 重跑。432f0d88 改成比较 site.video() 与已绑定对象，并在 start 以 **1500 毫秒**检查改绑；移除旧 timeupdate 再绑定新的。根因不在 mainVideo 选中了错误的可见元素，不保留“隐藏视频正在播放”的猜测为事实。

结果与保留：2026-10-24 记录 TED-1 修复后四轮广告交接都出现英语字幕及侧栏当前句，监听器数量未叠加。旧案例对 TED-2 有“18.9 秒出现字幕”和“仅载入、未播放”的不同表述，未取得可区分轮次的证据，本次不据此扩大通过范围。Vimeo 只确认英语 6 句载入；当时播放器在无扩展对照也无法播放，播放联动仍未证。下次分别核字幕会话与当前绑定 video，不因字幕载入成功推断播放联动成功。本轮核 diff 和现行实现，没有操作真实浏览器。

## L-006 网页视频继续学习：读回轨道、恢复入口和状态合并必须一起接上

适用：B站、课程页等已接入的 WebVideoSite 阅读器刷新或重新载入；YouTube 共用恢复位置与状态写入部分。

根因已复现：_loadWeb 原先不读写现成的 selectedTrackKey，刷新总选默认英语，旧偏移也因轨道不同而不恢复；侧栏已创建 resume 按钮却未挂进 DOM。另一方面，字幕选择/偏移/播放进度都是 studyVideoState 的读改写，并发时最后一笔覆盖前两笔；初始渲染又可能在读回上次位置前先保存当前零秒。这些是同一“下次继续学”链路的断点，不需要另建状态库。

现行做法：复用 selectedTrackKey，WebVideoSite.load 区分显式 sourceId 与自动恢复 preferredId，自动恢复的轨道失效/读不到时试原有可用来源，显式选择仍不悄悄换语言。恢复前阻止初始进度写入，恢复后继续原节流；标题区挂回现成 resume 按钮，仍只在点击时跳转。字幕选择、偏移、进度在同一页面内串行合并，读回先等待本页已排队写入；跨标签页的全局原子性没有因此获得保证。原字段、每视频身份与300条上限保留，不引入设置或迁移旧笔记。

证据：test/study-web-reader.test.js 中新增一个连续场景，先复现错误默认英语，再覆盖恢复中文/偏移与继续入口、显式切英语、旧轨失效退回、并发三种保存后再次载入；原跟读/偏移用例也通过。旧用例查侧栏的 offset output 已与“偏移只放视频面板”的现行UI不符，移除该过时位置断言，实际会话时间和持久偏移断言保留。测试使用临时DOM和内存storage，无真实站点、模型、Vault或Anki调用；源码安装与用户浏览器重载另记交接。

## L-007 视频已记词退回制卡：恢复原记录，而不是只带词和句子

适用：视频里的已记词找不到当前字幕行，`_openSavedWord` 改走后台 `openStudyRecord`。学习库原有 `createResumeUrl` 已保留来源上下文，不需要再造一套网址参数。

确定缺口与先后证据：第一批先复现旧后台只传 query/full/recordId，search-main 对缺失的来源URL、标题、上下文和时间使用空值；当时未执行保存，只确认入口缺字段。继续核对发现恢复页还没有读回保存的解释、译文、学习提示；本机journal缺失时，临时真实Python保存链已复现旧解释被词典简释覆盖。补充语境也会因默认未勾“带上邻句”变空。后者已有临时笔记持久化证据，不是正式库损坏报告。

处理：后台按已校验的记录ID调用现有 libraryRead，采用原记录而不是网页传来的元数据；复用移入既有 study-data.js 的恢复函数。搜索页再按ID读当前记录，把保存内容交给原词卡控制器，仍复用恢复网址的旧文章JSON兼容；原记录已选语境直接恢复，新查词仍不默认发送邻句。读不到则说明回学习库重试，不开空内容补卡。打开时已经在原笔记turnIds内的本机回答只显示为历史，不用旧缓存覆盖当前读回的笔记；之后产生的新ID即使已被自动同步确认，仍是本次回答，保存后继续承接。不新增持久格式，turnIds原本已在记录中；只补前端读回快照与现有类型声明。没有新配置、数据格式、字幕授权或保存系统。

证据：test/study-translation-controls.test.js 单个新增场景验证来源URL（含B站p）、标题、上下文、视频秒数、语言、原句、记录ID及制卡开关，并覆盖读取失败不开新页；学习库原有两个相关场景继续通过。test-localization/test-study-library-flow.mjs 新增一条连续场景使用临时Python库/Anki替身，确认无本机journal的恢复/再次保存不丢文本、语境卡预览采用保存解释、追加新回答和重复保存后仍保留在同一笔记；原笔记保存用例也通过。没有创建卡片、实际模型调用或正式库验收。结果见交接“2026-11-11 已记词补卡来源恢复 / 恢复笔记的学习内容”。2026-11-11接续纠错：a9db74da最初用saved标志过滤历史，其用例当时没有强制等自动同步先确认；快同步会把本次新回答也过滤掉，随后再次保存又回退旧解释。原临时库用例增加“先flush再显示/保存”后实际失败，再按打开时turnIds区分前后修正；同场景还核对重新打开当前笔记后，不让旧已保存缓存覆盖笔记后来修改的含义。相关两项场景通过，未调用模型或操作正式库。下次保持L-002的显式制卡与同词不同来源身份，不为恢复入口再增加存储，也不能把saved等同于“比本次快照旧”。

## L-008 换视频时旧字幕回来：最后一次await也要核视频身份

适用：改字幕载入、轨道保存或网页来源枚举。已有 _generation / _reset 是会话身份主机制，不增加另一套锁或版本号。

确定根因：YouTube _load 在取完正文后核过generation，却在后续 await writeVideoState 之后直接 _present。切视频会_reset递增generation并清空会话，但不能撤销已经开始的存储写入；旧写入一完成，旧session就被挂到新视频视图。一个延迟选轨保存的临时用例已实际复现旧session在reset后回来。

处理与保留：在既有代次机制上补齐YouTube轨道列表返回、选轨保存完成，以及网页异步来源枚举后的检查；先用局部sources收结果，身份有效再写当前字段。仍允许旧视频的选轨写入完成，不删除记忆、不取消用户已经确认的设置，不更动capture/refetch顺序、签名URL或新视频的控制器。

证据：test/study-caption-capture.test.js新增一个“保存中换视频”的用例，旧代码失败、修正后与原截取优先/英语退回/重发用例共2项通过；reader lint仍64、该测试0，无新增诊断。本轮未操作真实Chrome，不把异步夹具说成实机已复现。交接见“2026-11-11 换视频异步载入身份”。

## 增量与覆盖

2026-11-11 自主实施从 main@d4d50c44 接续，目标是现有视频阅读器继续学习，不重做字幕接入。定向读取 roadmap / 一站式计划、L-001—L-005、字幕状态与网页读取实现；新增用例与既有跟读用例共2项通过。没有复盘全部历史或恢复旧App任务。相关结果见交接“2026-11-11 视频继续学习”。

2026-11-11 本次定向归并：固定读取截点为 main@4b12ef9147380bd3568f7a953c38b00e57c7569d。完整读取现行 PROJECT_MEMORY、AGENTS 及 Vault 项目 README/项目总览；交接读取前90行和末段 YouTube/TED/B站案例，不称交接全文。核 d58079bc、b424fa2b、de635ac3、d3c0132b、432f0d88、716e48ae 的相关产品 diff，现行 WebVideoSite、reader 的有关实现，以及字幕截取测试正文；补 L-001 与 L-003—L-005，更新交接顶部和 Vault 阅读摘要。没有运行扩展/模型、测试或正式学习链，没有建立全历史处理游标；较早未覆盖内容仍是缺口。本次文档提交不代表 2026-10-24 之后有新的产品验收。

同一问题持续更新；保存现象、证据、原因确定程度、实际试过方案和淘汰理由、实现/测试位置、真实反馈、下一次触发和替代关系。别把提交条数当经验条数。

2026-11-10 规则读取截点：`main@f496f4524edc6c4e0e35f1f1fd1405dbdba0147b`。已读根 AGENTS、交接前100行（工具展示被截断，未称交接全文）、B站多P提交完整 diff、相关 Vault 入口/历史反馈。未全读 fork 上游、所有提交/分支/源码，未访问本机 dirty、Chrome、正式 Vault/Anki 或运行测试。**全历史处理游标尚未建立**；当前 SHA 是读取截点，不是“之前全已总结”。

全周期输出与续读按 AGENTS：形成阶段/能力逻辑链/经验/体验/覆盖缺口/后续取舍，保存读回再前移。此页不部署自动化，不恢复旧任务。

## 2026-11-10 接手与持续维护补充范围

本次从 `main@c055aecd047aeed84d2de23054c28684ce2750ec` 读取现行 AGENTS/本页及项目入口，补自然称呼索引、每轮主动写回和上下文恢复/纠错做法。未完成的历史覆盖仍按原记录；这次规则提交不前移全历史处理点，未重跑产品、部署拦截器或建立后台任务。
