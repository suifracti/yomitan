# 优化路线与前后端约定（2026-10-20）

分工（2026-10-20 本轮更新）：**前后端均由 GPT 实现；Claude 出方案、定 UI、检查提交。** 以 GitHub main 为准接续，开工和提交前先 fetch。
节奏：不排日期，分批连续做完；每批自检、提交、推送后直接进入下一批。

## 工作方式（每次开工必读）

目的：做出能用的功能，不在自己设的关卡上反复打补丁。

1. **防御只留真正的边界**：
   - 只防御这几处：
     - 外部输入：网页、字幕文件、Native 返回；
     - 写入保护：不写 Obsidian 正式笔记、不写 Anki、不改排程；
     - 冻结的发行包。
   - 内部数据可以信任，不为不可能出现的状态写分支。
2. **测试要少而准**：
   - 每项功能一个正常路径测试，加一个"后端缺失时能退回"的测试。
   - 不写组合矩阵，不为同一行为重复测试。
3. **范围**：
   - 只做本文写明的东西。
   - 不新增配置项、抽象层或兼容分支，除非本文写了。
   - UI 按 Claude 的决定做，不自行加选项。
4. **停下来简化**：
   - 同一个问题修了 2 次还不通，就停下来，把那段流程从头简化重写，不要继续打补丁。
   - 自己加的检查如果妨碍了主流程，就删掉，不要为它再加补丁。
5. **改动量**：单项改动超过约 300 行，先停下来，在提交说明里写清原因。

规则不变：
- 不读 Obsidian，测试只用临时库和替身。
- 默认不调用付费模型；需要模型的功能默认关闭。
- 不新建分支或 PR。
- `companion-app/` 保留、不提交。

**前端会先按本文的约定做好兼容**：后端还没上线时，自动退回旧行为；后端上线后，新功能直接生效。约定如果需要改，请先改本文，再改代码。

## 检查发现

| # | 问题 | 归属 |
|---|---|---|
| 1 | `word_status`、`video_words`、`auto_sync` 每次全量读记录文件（自动同步每 30 秒一次） | B1 |
| 2 | 每次本机请求都 `connectNative` 冷启动一个 Python 进程 | B4 |
| 3 | 日常扩展目录和运行中的桥靠手工拷贝；`install-metadata.json` 已过期；扩展不知道桥的版本 | B3 / F6 |
| 4 | 掌握度只有 learning/known 两档，没用到 Anki 的复习间隔和遗忘次数 | B2 / F3 |
| 5 | `youtube-reader.js` 1500 行、`study-service.js` 1240 行、`study_library_core.py` 1140 行 | F1 / B 项各自顺手 |
| 6 | 字幕列表一次渲染全部行，长视频会卡 | F2 |
| 7 | 读不到本地视频（`file://`）和跨域 iframe 里的播放器 | F5 |
| 8 | 测试债：工作区浏览器测试抖动；`test_study_video` 有一项失败；`test-study-library-flow.mjs` 留着旧的自动择卡断言；tsc 基线 98 个错误 | B6 / F8 |
| 9 | 旧 ASB 受保护 cue 记录不能制卡、不能同步，和新阅读器是两套路径 | B5 |
| 10 | **"认识这个词，却看不懂这句"没有被记录**：掌握度按词汇总，新义项、搭配、句子结构、一时没认出这几种卡点都会漏掉 | B8 / F9 |

用户已确定：
- 遇见次数、悬停释义、挑句与难度、本地视频与 iframe、今日回顾、AI 批改（可选，默认关）全部纳入这一轮。
- 卡在哪由用户自己点选；AI 预选是可选项，默认关。
- 全部义项都会的词不标色；只要还有义项在学，就保留极淡提示。

## 后端（GPT）

顺序：B1 → B3 → B2+B8 → B6 → B5 → B9 → B4（测得慢才做）→ B7。

- **B1 记录索引**
  - 索引存在 cache_dir 的 `.study-index.json`，不放进 Vault。
  - 每条记录存：mtime、size、word、lemma、media_key（复用 `media_key_of`）、videoTime、mastery、各卡阶段、noteId、义项键。
  - 按 mtime 增量更新。
  - `word_status`、`video_words`、`auto_sync` 的变化检测、`libraryList` 改读索引；接口不变。
  - 性能：2000 条记录，一轮自动同步 < 300 ms。
- **B2 真实掌握度**：随自动同步，用 `cardsInfo` 读 interval 和 lapses，填入下面约定的 `libraryWordStatus` v2；不新增轮询。
- **B3 体检与同步脚本**
  - 新增 `bridgeHealth` 动作（格式见下）。
  - 安装器写入真实的文件清单。
  - 新增 `dev/sync-local.py`：
    - 只同步日常扩展目录和 `~/Library/Application Support/EnglishStudyTranslator`；
    - 运行中的桥必须等于上一个提交，才按字节同步；
    - 拒绝写入冻结的发行包（`english-study-extensions/local-bridge`、`asbplayer`）。
  - 生成 `ext/js/study/bridge-manifest.json`（桥文件名 → sha256），供 F6 比对。
- **B8 义项与卡点**：
  - 记录增加 `entry.sense` 和 `contextMiss`；
  - 搭配存成 `expression` 条目并链接原词；
  - 词笔记新增「义项」小节；旧笔记不迁移。
  - 动作见下。
- **B6 测试债**：修好上表第 8 行列出的后端项。
- **B5 统一 ASB 路径**：字幕记录也能制卡、双向同步；授权校验保留，只作来源证明。
  - 首次字幕来源仍从私有校验链取得，网页不能伪造 `subtitleSource` 或 `cueAuthorization`。已保存记录按 ID 使用普通显式制卡、补充和双向同步；旧来源快照保持不变。可选的内部授权若携带，仍须匹配该记录的来源。
  - 「记住它」同样只保存笔记，不再为 ASB 自动择卡；旧待交任务只能重试已经确认的卡，不重发模型。编辑后的原句属于学习字段，原始字幕证明不随之改写。
- **B9 今日回顾数据**：新增 `ankiToday` 动作。
- **B4 常驻连接**：先测冷启动耗时，超过约 150 ms 才改成懒连接的常驻 port；空闲 60 秒断开。
  - 内部 `bridgePing` 只返回 `{ok:true,pong:true}`，用于隔离浏览器的真实 `connectNative` 启动测量；不读配置、笔记、Anki 或模型，也不进入前端功能列表。
- **B7 AI 批改**：新增 `practiceCheck` 动作，默认关闭，沿用现有额度上限。

## 前端（Claude）

1. F1 拆分阅读器 + F2 虚拟列表 + F8 修复抖动
2. F9「认识却卡住」提示 + F3 多档标色、遇见次数、悬停释义
3. F4 挑句（i+1）与视频难度
4. F5 本地视频与 iframe 播放器
5. F6 系统状态页 + F7 今日回顾 + B7 的批改界面（未开启时隐藏）

## 数据约定

### `libraryWordStatus` v2（B2 + B8 → F3 / F4 / F9）

后台把 `response.library` 整体存到 `chrome.storage.local.studyWordStatus`，存储格式为 `{at, version, words, phrases}`。

```json
{
  "version": 2,
  "words": {
    "brick": {"s": "learning", "iv": 3, "lapses": 0, "senses": 1, "gloss": "砖"},
    "run":   {"s": "partial",  "iv": 40, "lapses": 1, "senses": 2, "gloss": "跑；经营"}
  },
  "phrases": {
    "run into": {"s": "learning", "gloss": "偶遇"}
  }
}
```

字段说明：
- `s` 的取值：
  - `new`：已保存，还没有卡；
  - `learning`：有卡，间隔 < 21 天；
  - `shaky`：近 30 天遗忘过，或用户点了「一时没认出」；
  - `familiar`：所有义项的卡间隔都 ≥ 21 天；
  - `known`：familiar，并且有第 3 阶段的卡；
  - `partial`：部分义项是 familiar 或 known，另一部分是 new、learning 或 shaky。
- `iv`、`lapses`：这个词所有卡里的最小间隔（天）和总遗忘次数；没有卡时省略。
- F4 另读可选 `newSense:true`：从已有 newSense 卡点事件得出，表示本人选过新意思；不改变原掌握度分档，不新增记录或配置。
- `gloss`：≤ 40 字的中文短义，只给悬停释义用；不能含句子、笔记或来源。
- 复习数据在原自动同步的一轮内批量读取并缓存；最近遗忘用 Anki 的 `rated:30:1`（Again）记录判断，不从累计 lapses 猜发生日期。断连保留上次读到的数据，未读到间隔时不把第③阶段卡直接算成已掌握。
- 键名：小写的 word 和 lemma 都写入，同一个词的两个键共用同一个值。
- 兼容：旧格式（`words` 的值是字符串 `"learning"`/`"known"`）前端照常处理。

### 义项与卡点（B8 ↔ F9，词卡在扩展页面内调用）

#### `libraryWordSenses`

请求：

```json
{"action": "libraryWordSenses", "word": "run", "language": "en"}
```

返回：

```json
{
  "senses": [{"key": "run#1", "gloss": "跑", "s": "known", "contexts": 2, "cards": 3, "recordIds": ["…"]}],
  "phrases": [{"text": "run into", "gloss": "偶遇", "s": "learning", "recordId": "…"}],
  "misses": {"newSense": 1, "collocation": 0, "structure": 2, "recall": 1}
}
```

#### `libraryContextMiss`

请求：

```json
{"action": "libraryContextMiss", "word": "run", "lemma": "run", "language": "en", "kind": "newSense", "senseKey": "run#1", "sentence": "…", "url": "…", "videoTime": 12.5}
```

- `kind` 的取值：`newSense`、`collocation`、`structure`、`recall`。
- 只追加一条事件（时间、kind、相关记录 ID），不建卡。
- `recall`：把 `senseKey` 对应的义项计为 shaky，持续 30 天。
- 返回：`{"ok": true}`。

#### 保存新义项或搭配（沿用 `librarySave`，`entry` 新增可选字段）

- 新义项：`entry.sense = {"key": "new", "gloss": "经营"}`。由桥分配真正的键（`<lemma>#<n>`）；这个义项的掌握度从 `none` 开始。
- 搭配：`entry.kind = "expression"`、`entry.word = "run into"`、`entry.baseWord = "run"`。
- 不带这些字段时，行为和现在完全一样。
- 不改旧记录 ID，不批量迁移。旧语境在只读汇总中使用稳定的默认义项键；新带 `sense` 的记录 ID 纳入实际义项键，因此同句的新义项也不会继承旧卡掌握度。重复 `new` 保存按同语境和 gloss 复用已分配键，指定已有键则关联该义项。卡点事件附在已有的相关词记录上（优先当前语境/指定义项），不因点卡点而另建笔记或卡片；没有已保存词记录时提示先保存。
- 默认 `#1` 留给未细分的旧/普通语境，显式新义项从 `#2` 分配，避免以后一次普通保存误并入已经学会的新义项。最近 Again 的时间范围采用 [Anki 官方搜索语法](https://docs.ankiweb.net/manual/searching)。

#### `senseMatch`（可选，用模型，默认关）

请求：

```json
{"action": "senseMatch", "word": "run", "sentence": "…", "contextMeaning": "经营", "config": {"model": "…", "effort": "low"}}
```

返回：

```json
{"match": "run#2", "confidence": 0.8}
```

- 不属于已学义项时，`match` 为 `"new"`。
- 结果按 word + 句子哈希缓存。

### `bridgeHealth`（B3 → F6）

请求：`{"action": "bridgeHealth"}`。返回：

```json
{
  "files": {"study_translator.py": "<sha256>"},
  "python": "3.14.0",
  "vault": {"ok": true},
  "anki": {"ok": true, "version": 6},
  "appleTranslate": true,
  "autoSync": {"at": 0, "synced": 0, "conflicts": 0},
  "errors": [{"at": 0, "action": "librarySave", "message": "…"}]
}
```

- `errors` 最多 20 条，只含动作名和错误文案，不含学习内容。
- F6 拿 `files` 和扩展内的 `js/study/bridge-manifest.json` 比对；不一致时，提示运行 `python3 dev/sync-local.py`。
- `bridge-manifest.json` 列出受版本控制且实际安装的 Python 桥模块；`bridgeHealth.files` 计算运行目录的实际字节（可另外含已编译的 `apple-translate`）。安装器的清单同时记录该可选二进制。体检不读取笔记正文；错误摘要只存动作和不含学习原文的固定错误文案。
- `sync-local.py` 先核对运行桥的全部模块与上一个提交一致；扩展只同步本批 Git 变更的源码文件，不覆盖无关的本机 UI 改动，也不删除文件或读取 Chrome 存储。

### `ankiToday`（B9 → F7）

请求：`{"action": "ankiToday"}`。返回：

```json
{"due": 23, "reviewed": 40, "newDue": 5, "decks": ["外语"]}
```

- 只统计设置里的学习牌组。
- Anki 没开时返回 `{"paused": true}`。
- `due` 为今天待复习和待学习数量（不含新卡），`newDue` 为调度器给出的新卡数量；`reviewed` 按 Anki 学习日统计今天答过的不同卡片。只查询当前设置的默认牌组和分类牌组，父牌组已涵盖的子牌组不重复相加；不创建缺失牌组、不改变当前牌组或排程。

### `practiceCheck`（B7，可选）

请求：

```json
{"action": "practiceCheck", "id": "<记录ID>", "kind": "make-sentence", "prompt": "…", "answer": "…", "config": {"model": "…", "effort": "low"}}
```

- `kind` 为 `make-sentence` 或 `produce`。

返回：

```json
{"verdict": "almost", "corrected": "…", "reason": "一句话说明"}
```

- `verdict` 的取值：`good`、`almost`、`wrong`。
- 结果追加到该记录笔记的「练习」小节，一次一条；不建卡，不改排程。
- 默认关闭：沿用 `settings` / `saveSettings` 的 `studySettingsV2`，新增 `practiceEnabled`（缺省 false）；扩展服务在未开启时拒绝 `practiceCheck`，开启后仍只在明确点击时调用。Native 的 `config` 仍严格只有 model/effort，不把 UI 开关混入。
- prompt 与 answer 各 1–2400 字；仅提供选中记录的词、原句、含义和译文给模型，不发送路径、整篇笔记或其他语境。复用原模型校验、100 秒超时、单请求锁与用量记录；账号本身的额度不足仍由现有模型链报错，当前没有独立的数字配额设置，不另造额度系统。
- 同一材料、题目、答案和模型设置的重试不重复追加。已完成的结果可在原 cache_dir 临时保留，落笔记失败时仍返回批改结果，另带 `saved:false,error:"…"`；再次明确点击同一请求可重试写入，不重新调用模型。前端不得自动重发付费请求。成功返回原三字段，无需新增数据表或卡片。

### 纯前端存储（无需后端）

- `studyEncounters`：遇见次数。格式为 `{词: {n, days: {YYYY-MM-DD: n}, sites: [域名哈希…≤20]}}`，只保留 30 天；不存网址或句子。
- `studyVideoState`：每个视频的偏移和进度（已上线）。

## 状态

| 项 | 负责 | 状态 |
|---|---|---|
| B1 记录索引 | GPT | 已完成：cache_dir/.study-index.json；mtime/size 增量；2000 条安静同步约 58 ms（临时库/Anki 替身） |
| B2 真实掌握度 | GPT | 已完成：自动同步批量读 interval/lapses/近期 Again；v2 words/phrases；旧界面兼容 |
| B3 体检与同步脚本 | GPT | 已完成：bridgeHealth、真实模块/二进制安装清单、bridge-manifest、限定目标及上个提交校验的 sync-local.py |
| B4 常驻连接 | GPT | 已实测：隔离 Chrome for Testing 149、实际安装桥、20 次新 connectNative；中位 49.2 ms、p95 68.8 ms、最大 71.2 ms；低于 150 ms，保留短连接，不引入常驻 port |
| B5 统一 ASB 路径 | GPT | 已完成：保留私有来源证明；已保存字幕可多卡、收藏、后续问答及双向/自动同步；记住只存笔记；36 项 Python、49 项 Node 定向检查通过 |
| B6 后端测试债 | GPT | 已完成：原生来源测试 15 项、桥协议 16 项、保存流程 7 项通过；旧自动择卡断言改为只存笔记；指定两模块及 study-service 类型错误为 0（全仓仍有前端错误） |
| B7 AI 批改 | GPT | 已完成后端：practiceCheck 默认关、显式开启/调用、复用受限模型与用量链；当前材料追加到原笔记练习，重试去重、写失败保留结果；无卡片/排程变更；128 项 Python 与定向 Node 检查通过（模型/Anki 替身） |
| B8 义项与卡点 | GPT | 已完成：独立义项身份、搭配关联、卡点事件、30 天 recall、显式可选 senseMatch 与缓存；旧笔记不批量迁移 |
| B9 今日回顾数据 | GPT | 已完成：ankiToday 按当前设置牌组统计 due/reviewed/newDue；父子去重、无空组创建；关闭/停用返回 paused；临时 Native/Anki 替身通过 |
| F1 拆分阅读器 / F2 虚拟列表 / F8 抖动 | Claude | 进行中 |
| F3 标色、遇见次数、悬停释义 | Claude | 待做 |
| F4 挑句与难度 | GPT | 已完成：保存词规则星标、最多 10 句推荐并 revealRow、灰字语速/在学词数；Chrome 星标与旧后端退回各一次通过 |
| F5 本地视频与 iframe | GPT | 已完成：本地文件名/秒数身份、导入提示、file 顶层后台放行；iframe 内运行，600px 以下仅字幕层；本地 Chrome 与旧后端退回各一次通过（实际文件权限由用户开启） |
| F6 系统状态 | GPT | 待做 |
| F7 今日回顾 | GPT | 待做 |
| F9 认识却卡住 | Claude | 待做 |

## 本轮固定 UI 与执行边界（2026-10-20）

- 先用临时库真实 B2+B8 返回联调 a56fd5ba 的 word-marks / study-stuck；不读正式 Vault、不调用付费模型。
- F4：5–20 词、恰好一个在学词的字幕行标 ★；仅用户保存词（new/learning/shaky/partial 或选过新意思）。本视频生词顶部最多 10 条推荐，点击 revealRow；标题灰字只显示语速与在学词数，不加词频表或难度等级。
- F5 本地来源 URL 使用实际视频 file URL 的 `#study-duration=<秒>` 保存真实时长（不读文件正文）；JS/Python mediaKeyOf 共同解析。file 顶层内容脚本可传此 URL 生成本视频小结，后端只做学习元数据处理，不用该路径读取文件。
- F5：file:<文件名>|<四舍五入秒数>；无字幕提供原导入入口；file 顶层允许后台字幕动作。iframe 内运行字幕和控件，宽 ≥600 才显示侧栏，不做跨帧同步。
- F6：设置页系统状态五行（桥版本、Anki、Vault、Apple 翻译、文件网址权限），进入时一次读取、手动刷新；版本不符复制同步命令，错误 details，不轮询。
- F7：现有自动同步带刷新 due 角标，paused/0 清空；学习库一行今日统计。若直接可用则加只打开 Anki 的入口。
- B7 UI：AI 区唯一新增 practiceEnabled 勾选；开启时只有用词造句 / 中→英卡型显示输入与批改结果三行；关闭完全隐藏。
- 每项只写正常与旧后端退回两个测试，不做矩阵。真实 Chrome 只验 F4 星标与 F5 本地视频，其余 Vitest。单项约 300 行以上先审视必要性并在提交说明解释，不加额外抽象或配置。
- 0 联调：临时 Python YomitanLibrary/Anki 替身的 v2 words/phrases、义项和卡点返回与现有前端一致；旧桥仍能本地选择新意思。无需改原接口。
