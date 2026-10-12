# AGENTS.md · 外语学习系统接手路由（2026-10-12）

> **本仓库是代码与历史执行证据，不是外语学习系统的当前规划主源。** 旧称「英语学习系统」。此文件只负责引导新 AI，不另建规划。

## 新 Agent 必须先核对

1. 先通过 Obsidian MCP 读取 Vault 根 `AGENTS.md`，遵守 Vault 读写和逐轮同步约束。
2. 从 `03-项目与工程/外语学习系统/README.md` 进入项目；`Decisions.md` 是**现行产品与技术决定**，`Handoff.md` 是**最新交接、已验与未验、唯一下一阶段**，`资料与来源.md` 是 Google Drive 附件和 GitHub 代码证据索引。
3. 再按 Handoff 指定的任务核对 **本机活动工作树、未提交改动、真实已加载插件和源码**；GitHub main 不等于用户日常运行版。不要用历史 study7/study19 的“当前”替代新交接。
4. 如无法访问 Obsidian，明确说明缺少当前交接，并请求用户或具有 Vault 权限的协作者提供上述三篇的最新内容；**不能凭此仓库的旧规划、README 或 Issue #1 自行接续开发**。

## 来源与权限边界

- 原 [ENGLISH_LEARNING_PLAN.md](https://github.com/suifracti/yomitan/blob/main/ENGLISH_LEARNING_PLAN.md) 已是**2026-10-11 历史规划快照**；[Issue #1](https://github.com/suifracti/yomitan/issues/1) 保存旧执行报告/评论。二者都不是新的派工、模型费用、真实数据写入或发布授权。
- 代码仍在 [suifracti/yomitan](https://github.com/suifracti/yomitan)、[suifracti/asbplayer](https://github.com/suifracti/asbplayer) 与本机既有工作树；交接文件正文在 Obsidian，报告/HTML/补丁/包等附件在 [既有 Google Drive 文件夹](https://drive.google.com/drive/folders/1yj5UZvKGsyrgHpmdNRoEv3ixyK-hG-kZ)。
- 现在的定案是**复用 Yomitan/asbplayer/IINA 与既有 StudyService、Python 保存链，增量做 Electron 薄伴学 App**；不自行重建播放器、浏览器、词典或复习系统。应用是否真正做完，以 Handoff 所列实机验收为准。
- 默认不开 PR、不派 Agent 任务、不因历史“做完了”重新启动工作包。修改代码、安装、付费调用、真实笔记/Anki 读写、推送或发布以当前用户明确授权为准；不得删除学习数据、卡片、复习排程。一个实际工作树同一时刻仅一名写入者。

此路由更新不代表本机扩展、Mac App 或任何真实学习链路已完成验收。
