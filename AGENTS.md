# AGENTS.md · 外语学习系统接手路由（2026-10-12）

> **本仓库当前 main 是 DeepSeek 与 Claude 的共同开发依据。** 接手先看下方隐私规则及 [当前交接](docs/youtube-study-wiring.md)，不要自动打开 Obsidian。

## 当前接手与隐私规则（2026-10-19 用户更新）

- DeepSeek 与 Claude 共同开发，以 **GitHub 当前 main 与仓库交接**为代码进度依据，用户不负责互相转述。每轮开工和提交前 fetch 核对远端，接续已推送改动；保留本机未提交工作，不覆盖、不强推。
- **Obsidian 权限按实施方区分（2026-10-23 用户明确）：DeepSeek 未获授权，需要时逐个文件夹先问用户，读取与写入都需单独授权；Claude 仍须用户逐个文件夹明确同意，读取与写入都需单独授权。** 不沿文档链接、缓存、历史、MCP、终端或子代理绕过。特别不碰高考、备考、学科与其他个人内容，除非用户明确指定。任何 Vault 路径本身不构成对实施方的授权。
- Claude 优先使用用户提供的交接与源码；确实需要项目笔记时，先说清完整文件夹、具体文件、用途并等待许可，原有自动读取/逐轮同步约定不用于扩大其权限。DeepSeek 同样按任务申请，获准后写入前先读原文件，只做必要的最小改动，保持笔记格式与桥的解析一致。
- 核对原活动工作树、dirty、真实安装与运行版；不把 GitHub 已推送当成 Chrome 已重载或真实学习链路已验收。
- **2026-10-23 最新分工：DeepSeek 实现前端和后端；Claude 出方案、定 UI、审查提交。** UI 按用户与 Claude 已定方案做，不擅自增加选项或层级。
- 子代理只承担清晰的小任务，不能替代主 Agent 的核心判断；关键模块主 Agent 亲自负责，卡住或质量不够及时接管，不反复派工拖进度。简单任务不拆分。
- 后续提交保留用户的 Git 作者身份，DeepSeek 实施的提交增加 `Co-authored-by: DeepSeek <noreply@deepseek.com>`；不把 Claude 的工作冒签为 DeepSeek。原 GPT/Codex 的署名与派工规则随分工变更不再沿用。

## 来源与权限边界

- 原 [ENGLISH_LEARNING_PLAN.md](https://github.com/suifracti/yomitan/blob/main/ENGLISH_LEARNING_PLAN.md) 已是**2026-10-11 历史规划快照**；[Issue #1](https://github.com/suifracti/yomitan/issues/1) 保存旧执行报告/评论。二者都不是新的派工、模型费用、真实数据写入或发布授权。
- 代码仍在 [suifracti/yomitan](https://github.com/suifracti/yomitan) 与本机既有工作树；asbplayer 定制 fork 已于 2026-10-21 删除，发行包也不再包含。既有 Obsidian 内容按上方权限规则处理，历史报告/HTML/补丁/包等附件在 [既有 Google Drive 文件夹](https://drive.google.com/drive/folders/1yj5UZvKGsyrgHpmdNRoEv3ixyK-hG-kZ)。
- **2026-10-15 当前决定**：独立 App 已停止，只优化现有 Yomitan/IINA 与 StudyService、Python 保存链；asbplayer 定制版不再需要，2026-10-21 已删除仓库与本地包。不恢复历史 App 规划，这是历史决定，不恢复旧任务；本轮接续仓库交接。
- **用户明确只用 `main`**：沿原工作树直接小改、自检后 commit/push 到个人仓库现有 main，不新开分支或 PR，不强推覆盖远端；冲突先保留本机改动处理。源码同步不等于发布或真实学习数据写入授权。
- 默认不开 PR，不因历史“做完了”重新启动工作包。修改代码、安装、付费调用、真实笔记/Anki 读写、推送或发布以当前用户明确授权为准；不得删除学习数据、卡片、复习排程。一个实际工作树同一时刻仅一名写入者。
- **2026-10-18 子代理规则（历史，随 2026-10-21 分工变更不再沿用）**：主 Agent 可按需要直接开子代理，不逐次询问；子代理只能用 **Luna / max**（当前工具标识 `gpt-6-luna`、`reasoning_effort=max`）。无法选择该组合时由主 Agent 自己做，不静默换其他子代理模型；简单任务不为形式拆分。该规则不扩大费用、正式数据或系统权限授权。

## 主 Agent 与实施方的责任（2026-10-18 用户补充）

- 主 Agent 确定方案、模块边界和必要验收标准；实施方（DeepSeek）只在指定范围实施，不擅自重新选架构。
- 主 Agent 必须读取实际代码差异和必要测试结果，不能只接受总结；验收不过就返修。
- 关键模块反复失败或暴露设计错误时，主 Agent 亲自调查、修改或重新拆分，不无限派实施方重试。

此路由更新不代表本机扩展、Mac App 或任何真实学习链路已完成验收。
