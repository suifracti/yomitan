# 优化路线与前后端约定（2026-10-20）

分工：**后端 B 项由 GPT（6.1 sol）认领，前端 F 项由 Claude 做**，以 GitHub main 为准接续。开工和提交前先 fetch。
节奏：不排日期，分批连续做完；每批自检、提交、推送后直接进入下一批。

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
- **B9 今日回顾数据**：新增 `ankiToday` 动作。
- **B4 常驻连接**：先测冷启动耗时，超过约 150 ms 才改成懒连接的常驻 port；空闲 60 秒断开。
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
- `gloss`：≤ 40 字的中文短义，只给悬停释义用；不能含句子、笔记或来源。
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

### 纯前端存储（无需后端）

- `studyEncounters`：遇见次数。格式为 `{词: {n, days: {YYYY-MM-DD: n}, sites: [域名哈希…≤20]}}`，只保留 30 天；不存网址或句子。
- `studyVideoState`：每个视频的偏移和进度（已上线）。

## 状态

| 项 | 负责 | 状态 |
|---|---|---|
| B1 记录索引 | GPT | 已完成：cache_dir/.study-index.json；mtime/size 增量；2000 条安静同步约 58 ms（临时库/Anki 替身） |
| B2 真实掌握度 | GPT | 待认领 |
| B3 体检与同步脚本 | GPT | 已完成：bridgeHealth、真实模块/二进制安装清单、bridge-manifest、限定目标及上个提交校验的 sync-local.py |
| B4 常驻连接 | GPT | 待测 |
| B5 统一 ASB 路径 | GPT | 待认领 |
| B6 后端测试债 | GPT | 待认领 |
| B7 AI 批改 | GPT | 待认领 |
| B8 义项与卡点 | GPT | 待认领 |
| B9 今日回顾数据 | GPT | 待认领 |
| F1 拆分阅读器 / F2 虚拟列表 / F8 抖动 | Claude | 进行中 |
| F3 标色、遇见次数、悬停释义 | Claude | 待做 |
| F4 挑句与难度 | Claude | 待做 |
| F5 本地视频与 iframe | Claude | 待做 |
| F6 系统状态 / F7 今日回顾 | Claude | 待做 |
| F9 认识却卡住 | Claude | 待做 |
