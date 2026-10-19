# AGENTS.md · 外语学习系统接手路由（2026-10-12）

> **本仓库当前 main 是 GPT/Codex 与 Claude 的共同开发依据。** 接手先看下方隐私规则及 [当前交接](docs/youtube-study-wiring.md)，不要自动打开 Obsidian。

## 当前接手与隐私规则（2026-10-19 用户更新）

- GPT/Codex 与 Claude 共同开发，以 **GitHub 当前 main 与仓库交接**为代码进度依据，用户不负责互相转述。每轮开工和提交前 fetch 核对远端，接续已推送改动；保留本机未提交工作，不覆盖、不强推。
- **未经用户逐个文件夹明确同意，不得读取、搜索、遍历、索引或扩读 Obsidian；写入也需单独授权。** 不沿文档链接、缓存、历史、MCP、终端或子代理绕过。特别不碰高考、备考、学科与其他个人内容。这里出现的任何 Vault 路径都不是读取授权。
- 优先使用用户提供的交接与源码。只有确实需要项目笔记时，先说清完整文件夹、具体文件、用途并等待许可；原有自动读取/逐轮同步约定不再用于扩大权限。
- 核对原活动工作树、dirty、真实安装与运行版；不把 GitHub 已推送当成 Chrome 已重载或真实学习链路已验收。
- 后续提交保留用户的 Git 作者身份，Codex 实施的提交增加 `Co-authored-by: Codex <noreply@openai.com>`；不把 Claude 的工作冒签为 Codex。

## 来源与权限边界

- 原 [ENGLISH_LEARNING_PLAN.md](https://github.com/suifracti/yomitan/blob/main/ENGLISH_LEARNING_PLAN.md) 已是**2026-10-11 历史规划快照**；[Issue #1](https://github.com/suifracti/yomitan/issues/1) 保存旧执行报告/评论。二者都不是新的派工、模型费用、真实数据写入或发布授权。
- 代码仍在 [suifracti/yomitan](https://github.com/suifracti/yomitan)、[suifracti/asbplayer](https://github.com/suifracti/asbplayer) 与本机既有工作树；既有 Obsidian 内容未经授权不得读取，历史报告/HTML/补丁/包等附件在 [既有 Google Drive 文件夹](https://drive.google.com/drive/folders/1yj5UZvKGsyrgHpmdNRoEv3ixyK-hG-kZ)。
- **2026-10-15 当前决定**：独立 App 已停止，只优化现有 Yomitan/asbplayer/IINA 与 StudyService、Python 保存链；不恢复历史 App 规划，这是历史决定，不恢复旧任务；本轮接续仓库交接。
- **用户明确只用 `main`**：沿原工作树直接小改、自检后 commit/push 到个人仓库现有 main，不新开分支或 PR，不强推覆盖远端；冲突先保留本机改动处理。源码同步不等于发布或真实学习数据写入授权。
- 默认不开 PR，不因历史“做完了”重新启动工作包。修改代码、安装、付费调用、真实笔记/Anki 读写、推送或发布以当前用户明确授权为准；不得删除学习数据、卡片、复习排程。一个实际工作树同一时刻仅一名写入者。
- **2026-10-18 子代理规则**：主 Agent 可按需要直接开子代理，不逐次询问；子代理只能用 **Luna / max**（当前工具标识 `gpt-6-luna`、`reasoning_effort=max`）。无法选择该组合时由主 Agent 自己做，不静默换其他子代理模型；简单任务不为形式拆分。该规则不扩大费用、正式数据或系统权限授权。

## 主 Agent 与 Luna Max 的责任（2026-10-18 用户补充）

- 主 Agent 确定方案、模块边界和必要验收标准；Luna Max 只在指定范围实施，不擅自重新选架构。
- 主 Agent 必须读取实际代码差异和必要测试结果，不能只接受总结；验收不过就返修。
- 关键模块反复失败或暴露设计错误时，主 Agent 亲自调查、修改或重新拆分，不无限派 Luna 重试。

此路由更新不代表本机扩展、Mac App 或任何真实学习链路已完成验收。
