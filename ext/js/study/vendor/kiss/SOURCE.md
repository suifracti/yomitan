# KISS Translator YouTube caption source

`youtube-caption-source.js` is copied unchanged from KISS Translator (fishjar / KISS Translator contributors), licensed GPL-3.0, compatible with Yomitan's GPL-3.0-or-later. See the repository `LICENSE` for the license text.

- Repository: https://github.com/fishjar/kiss-translator
- Ref: 7a7e2957ce2084d374f802b3537f2e0ca87cd7b8 (dev)
- Path: src/subtitle/youtubeCaptionSource.js
- Git blob SHA-1: aaa81cd31f67b470376b6c2f543afdd2a00509f6 (checked by `test/study-subtitle-session.test.js`)

Do not edit the JavaScript file; types live in the adjacent `.d.ts`. It only parses captions and picks tracks. It is not KISS's full page translation or settings.


## 2026-10-21 批 4 第一步：整页 / 悬停 / 划词调研（停在审查点）

**仅调研；没有引入下面的实现，没有新建 page-translate.js，也没有安装 React/npm 依赖。批 4、5 的功能未开始，批 6 未开始。**

### 本次固定来源

- 上游：[fishjar/kiss-translator](https://github.com/fishjar/kiss-translator)，GPL-3.0；本次仅下载源码到临时目录阅读，没有执行上游脚本。
- 固定 ref：`be97e68251adcd8a56754c803b43e0e90b0f269c`（dev，2026-10-21 查询时 HEAD）。这不替换上方已引入字幕 helper 的旧 ref。
- 行数按该 ref 原文件物理行计，包含注释/空行；表中 SHA 是 Git blob SHA-1。**表格是待审清单，不是已经 vendored 的文件。**

### 待审引入清单及依赖

| 模块 | 上游路径 | 行数 | Git blob SHA-1 | 直接依赖 / 边界 |
|---|---|---:|---|---|
| DOM 扫描（可独立） | `src/libs/translationTargets.js` | 66 | `e20c23be187b01fa2195a899acd6f9aa3188fa02` | 无 import；DOM 原生 API；需传入 isBlock/hasText/规则 |
| 并发取消（可独立） | `src/libs/translationTasks.js` | 27 | `fe43508a02df3a27923a11aa64e2ab9ab3362183` | 无 import；AbortController/DOMException |
| 全局规则常量 | `src/config/rules.js` | 227 | `c8f87768094b427005320dfd71a842805ae05ed5` | config/api、config/styles；不是完整站点规则订阅 |
| 规则合并（不建议整包） | `src/libs/rules.js` | 512 | `5edbe0b0289fe56b3afa48717a2a3fa5d1b42953` | utils、config、subRules、storage、sync、log、selectorList |
| 整页/悬停核心（超限） | `src/libs/translator.js` | 5541 | `d05e3fdf21c602efb64b2f1fac3c699ed62eec07` | 30+ 直接 import：config、interpreter、apis、pool、html、mathParse、detect、injectors、translationTargets 等 |
| 生命周期管理（不建议引入） | `src/libs/translatorManager.js` | 1123 | `71c71944eb7d2cf4f9de534f8eb1587088131a3f` | Translator、InputTranslator、TransboxManager、ShadowDomManager、React TouchTranslateControl 等 |
| 划词事件控制（需 React） | `src/hooks/useSelectionController.js` | 792 | `4019091b00e55c21c432123fa9e69141faecf43a` | React hooks、utils、mobile、detectFast、useAutoHideTranBtn、config、tranboxPosition |
| 划词按钮（需 JSX） | `src/views/Selection/TranBtn.js` | 46 | `98eae0f89db8b1d5940a16e8e9835b4c66fa744d` | MUI TranslateRoundedIcon；JSX |
| 划词窗口（需 JSX） | `src/views/Selection/TranBox.js` | 101 | `b72539754e8d48bc8d0601c2f40692dacfc98924` | React、DraggableResizable、TranslationPanel、useTranboxFocus、config、msg |
| 划词内容（需 JSX） | `src/views/Selection/TranCont.js` | 746 | `e40c6d6db9273eb59b7f3d50df5f249e95cda6ec` | React hooks、API/服务配置及其他词典/译文子组件 |
| 窗口外观（需 JSX） | `src/components/TranslationPanel/Surface.js` | 44 | `0bab3d0790c2576efbde419d478a6548a95f333c` | MUI Box/Paper、styles；JSX |
| 窗口头（需 JSX） | `src/components/TranslationPanel/Header.js` | 299 | `618c80bf6512940d9d86217e4d6b9af4a533e9e2` | React hooks、MUI 与图标；JSX |
| 窗口内容（需 JSX） | `src/components/TranslationPanel/Content.js` | 10 | `2df12b319e217b47962f3a37b2d9ab28669d7a3f` | views/Selection/TranForm；JSX |
| 窗口样式 | `src/components/TranslationPanel/styles.js` | 60 | `b0f8f4bdb5cfa7bffc81131e4cb349d739a84276` | 纯样式常量 |

### 三块逻辑确切在哪里

1. **整页**：`translator.js` 的 `#createIntersectionObserver`（1357 起）按视口调度，`#createMutationObserver`（1384 起）处理动态页；`#scanNode`（2656 起）调用独立的 `visitTranslationTargets`。`#processNode`（2733 起）分组与过滤，`#splitTextNodesBySentence`（3037 起）断段。**只有 66 行 traversal 本身不包含这些步骤。**
2. **双语 / 替换 / 还原**：`#translateNodeGroup`（3505 起）保留行内节点、包装原文、渲染译文及处理 `transOnly`；`#translateFetch`（4412 起）连接上游服务；`#cleanupAllNodes`（4485 起）与 `disable`（5265 起）还原。`toggleTransOnly`（5308 起）切换只看译文。不能拿一个文本替换循环冒充这套实现。
3. **悬停段落**：实际事件、定位、段落翻译和还原在 `translator.js`：`#toggleHoverBlock`（2162 起）、`#restoreHoverBlock`（2262 起）、`#translateHoverBubbleNode`（4108 起）、`#enableMouseHover`（4979 起）。`hooks/MouseHover.js` 只有 17 行，**只是 React 设置 hook，不是悬停翻译引擎**。
4. **划词**：`useSelectionController.js`（792 行）管选区、按钮定位、触发与隐藏；`views/Selection/TranBtn.js` / `TranBox.js` / `TranCont.js` 承接 UI。不是只复制共享的 TranslationPanel 就能工作。
5. **规则**：`config/rules.js` 提供 DEFAULT_SELECTOR、IGNORE/KEEP_SELECTOR 和 GLOBLA_RULE；`libs/rules.js` 混合订阅、本机存储和同步。按本方案只用内置全局规则，**不引入订阅、规则编辑和同步**；默认规则里的 label/legend 与跳过代码、输入框的边界，适配时仍需核对，不声称直接引入后天然满足所有要求。

### 体积与打包结论：必须停

- 可以无框架原样复制的两个小核心（translationTargets / translationTasks）合计 **93 行**，但不具备分段、渲染、还原、悬停、划词的完整能力。
- 整页 + 悬停的主要实现集中在 **5541 行的一个类**，单文件已经超过约 1500 行限额，且有大量依赖；再加生命周期管理不是“薄适配”。
- 原样引入划词按钮 / 窗口 / hooks 会要求 **React、MUI、JSX 转换**（见上游 package.json）；当前项目不能用浏览器原生 ESM 直接运行这些模块。没有为此加依赖或改变构建。
- 因此**没有批准任何整包复制清单**。建议 Claude 审查后明确：是否允许按上述位置抽取一个受限核心（这会修改源码，需逐段标出来源/差异），或放宽体积/构建约束。未定之前不创建适配层、不先写一套自己的 DOM 翻译器。
- 以后若引入原样文件，沿用上方 ref/path/blob 校验方式；若必须改 import/抽取方法，逐项记在这里，保留许可证与版权。当前新增实际文件数：**0**（本 SOURCE.md 除外）。
