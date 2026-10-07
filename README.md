# yomitan 中文学习定制版

仅维护 [suifracti/yomitan](https://github.com/suifracti/yomitan)，不向官方仓库推送或提 PR。

## 下载与加载

请从本仓库 **[Releases](https://github.com/suifracti/yomitan/releases)** 下载预构建安装包，不用 Code → Download ZIP（那是需构建的源码）。
两扩展统一包发布于 [asbplayer Releases](https://github.com/suifracti/asbplayer/releases)。解压到固定目录，在 Chrome 扩展页启用开发者模式，分别“加载已解压的扩展”选择 `yomitan`、`asbplayer` 文件夹。不要同时启用商店原版，避免重复扫描或录音。

新安装已预设中文界面、AnkiConnect `127.0.0.1:8766`、牌组 `外语::英语语境`、笔记类型 `外语语境卡` 和七个字段；不会迁移或覆盖旧扩展数据。Yomitan 随包提供 ECDICT 英汉词典，首次入门/设置页会自动导入，请等待提示就绪。Chrome 首次加载/授权须人工确认。Anki Desktop 必须运行且安装 AnkiConnect；此包不自动改任意机器的 Anki 数据库。

## 使用

- 文章/字幕：按住 **Shift** 悬停查词；中文释义由内置 ECDICT 提供。
- 视频：asbplayer 使用平台可检测字幕，或拖入自己的 SRT/VTT；不保证任意网站字幕自动可读。
- 视频语境制卡：使用 asbplayer 的制卡入口，或在 Yomitan 加词后用 asbplayer 更新上一张卡片补入音频/截图。普通查词制卡无需额外服务。
- **高级词汇状态标色依赖额外 yomitan-api 本机组件，当前包不启用。** 已预设 Word 字段和目标牌组，但不把配置称为已完成 Anki 复习回流。21 天等“成熟”阈值是软件规则，不是真实掌握。

## 更新与边界

独立公开扩展 key 固定本地版本 ID，与商店版分开；升级复用同一目录和同一 key，不再生成新 key。运行 `tools/check-upstream.sh` 只拉取并查看更新，不自动合并、推送或提交官方 PR。适配在自己的分支做，检查文案键、模板变量、权限与构建后再发布。

验证记录与构建说明见 `docs/personal-build.md`。构建及静态检查不等于真实浏览器加载、词典首次导入或视频/制卡运行验收。

---

以下保留上游原始说明。

# Yomitan

[![Get Yomitan for Chrome](<https://img.shields.io/chrome-web-store/v/likgccmbimhjbgkjambclfkhldnlhbnn?logo=Google%20Chrome&style=for-the-badge&logoColor=lightblue&color=lightblue&label=get%20yomitan%20for%20chrome%20(stable)>)](https://chrome.google.com/webstore/detail/yomitan/likgccmbimhjbgkjambclfkhldnlhbnn)
[![Get Yomitan for Firefox](<https://img.shields.io/amo/v/yomitan?logo=Firefox&style=for-the-badge&color=orange&label=get%20yomitan%20for%20firefox%20(stable)>)](https://addons.mozilla.org/en-US/firefox/addon/yomitan/)
[![Get Yomitan for Edge](https://img.shields.io/badge/dynamic/json?logo=puzzle&label=get%20yomitan%20for%20edge&style=for-the-badge&query=%24.version&url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fidelnfbbmikgfiejhgmddlbkfgiifnnn)](https://microsoftedge.microsoft.com/addons/detail/yomitan/idelnfbbmikgfiejhgmddlbkfgiifnnn)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/yomidevs/yomitan/badge?style=for-the-badge)](https://securityscorecards.dev/viewer/?uri=github.com/yomidevs/yomitan)

[![Discord](https://dcbadge.limes.pink/api/server/YkQrXW6TXF?style=for-the-badge)](https://discord.gg/YkQrXW6TXF)

# Visit [yomitan.wiki](https://yomitan.wiki) to learn more!

:wave: **Yomitan is [the successor](https://foosoft.net/posts/passing-the-torch-to-yomitan/) to Yomichan** ([migration guide](https://yomitan.wiki/yomichan-migration/)) which was [sunset](https://foosoft.net/posts/sunsetting-the-yomichan-project/) by its owner on Feb 26, 2023. We have made a number of foundational changes to ensure **the project stays alive, works on latest browser versions, and is easy to contribute to**.

📢 **New contributors [welcome](#contributing)!**

📢 **Interested in adding a new language to Yomitan? See [here](./docs/development/language-features.md) for thorough documentation!**

## What is Yomitan?

Yomitan turns your web browser into a tool for building language literacy by helping you **read** texts that would otherwise be too difficult to tackle in [a variety of supported languages](https://yomitan.wiki/supported-languages/).

Yomitan provides powerful features not available in other browser-based dictionaries:

- 💬 Interactive popup definition window for displaying search results.
- 🔊 Built-in native pronunciation audio with the ability to add your own [custom audio sources](https://yomitan.wiki/advanced/#default-audio-sources).
- ✍️ Kanji stroke order diagrams are just a click away.
- 📝 [Automatic flashcard creation](https://yomitan.wiki/anki/) for the [Anki](https://apps.ankiweb.net/) flashcard program via the [AnkiConnect](https://git.sr.ht/~foosoft/anki-connect) plugin.
- 🔍 Custom search page for easily executing custom search queries.
- 📖 Support for multiple dictionary formats including [EPWING](https://ja.wikipedia.org/wiki/EPWING) via the [Yomitan Import](https://github.com/yomidevs/yomitan-import) tool.
- ✨ Clean, modern code makes it easy for developers to [contribute](#contributing) new features and languages.

[![Term definitions](img/ss-terms-thumb.png)](img/ss-terms.png)
[![Kanji information](img/ss-kanji-thumb.png)](img/ss-kanji.png)
[![Dictionary options](img/ss-dictionaries-thumb.png)](img/ss-dictionaries.png)
[![Anki options](img/ss-anki-thumb.png)](img/ss-anki.png)

## Documentation/How To

**Please visit the [Yomitan Wiki](https://yomitan.wiki) for the most up-to-date usage documentation.**

### Developer Documentation

- Dictionaries
  - 🛠️ [Making Yomitan Dictionaries](./docs/making-yomitan-dictionaries.md)
- Anki Integration
  - 🔧 [Anki handlebar templates](./docs/templates.md)
- Advanced Features
- Troubleshooting
  - 🕷️ [Known browser bugs](./docs/browser-bugs.md)

## Installation

Yomitan comes in two flavors: _stable_ and _testing_. New changes are initially introduced into the _testing_ version, and after some time spent ensuring that they are relatively bug free, they will be promoted to the _stable_ version. If you are technically savvy and don't mind [submitting issues](https://github.com/yomidevs/yomitan/issues/new/choose) on GitHub, try the _testing_ version; otherwise, the _stable_ version will be your best bet. Check [contributing](#contributing) for more information on how to help.

- **Google Chrome**

  - [stable](https://chrome.google.com/webstore/detail/yomitan/likgccmbimhjbgkjambclfkhldnlhbnn)
  - [testing](https://chrome.google.com/webstore/detail/yomitan-development-build/glnaenfapkkecknnmginabpmgkenenml)

- **Mozilla Firefox**

  - [stable](https://addons.mozilla.org/en-US/firefox/addon/yomitan/)
  - [testing](https://github.com/yomidevs/yomitan/releases) ※

- **Microsoft Edge**
  - [stable](https://microsoftedge.microsoft.com/addons/detail/yomitan/idelnfbbmikgfiejhgmddlbkfgiifnnn)
  - Testing: Coming soon

※ Unlike Chrome, Firefox does not allow extensions meant for testing to be hosted in the marketplace. You will have to download the desired version and side-load it yourself. You only need to do this once, and you will get updates automatically.

## Contributing

🚀 **Dip your toes into contributing by looking at issues with the label [good first issue](https://github.com/yomidevs/yomitan/issues?q=is%3Aissue+is%3Aopen+label%3A%22gоοd+fіrst+іssսe%22).**

Since this is a distributed effort, we **highly welcome new contributors**! Feel free to browse the [issue tracker](https://github.com/yomidevs/yomitan/issues), and read our [contributing guidelines](./CONTRIBUTING.md).

Here are some ways anyone can help:

- Try using the Yomitan dev build. Not only do you get cutting edge features, but you can help uncover bugs and give feedback to developers early on.
- Document any UI/UX friction in GitHub Issues. We're looking to make Yomitan more accessible to non-technical users.
- All the issues in `area/bug` older than 2 months need help reproducing. If anything interests you, please try to reproduce it and report your results. We can't easily tell if these issues are one-off, have since been resolved, or are no longer relevant.

> The current active maintainers of Yomitan spend a lot of their time debugging and triaging issues. When someone files a bug report, we need to assess the frequency and severity of the bug. It is extremely helpful if we get multiple reports of people who experience a bug or people who can contribute additional detail to an existing bug report.

If you're looking to code, please let us know what you plan on working on before submitting a Pull Request. This gives the core maintainers an opportunity to provide feedback early on before you dive too deep. You can do this by opening a GitHub Issue with the proposal.

Some contributions we always appreciate:

- Well-written tests covering different functionalities. This includes [playwright tests](https://github.com/yomidevs/yomitan/tree/master/test/playwright), [benchmark tests](https://github.com/yomidevs/yomitan/tree/master/benches), and unit tests.
- Increasing our type coverage.
- More and better documentation!

Information on how to setup and build the codebase can be found [here](./CONTRIBUTING.md#setup).

If you want to add or improve support for a language, read the documentation on [language features](./docs/development/language-features.md).

Feel free to join us on the [Yomitan Discord](https://discord.gg/YkQrXW6TXF).

## Building Yomitan

1. Install [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/).

2. Run `npm ci` to set up the environment.

3. Run `npm run license-report:html` to generate any missing or changed license information.

4. Run `npm run build` for a plain testing build or `npm run-script build -- --all --version {version}` for a release build (replacing `{version}` with a version number).

5. The builds for each browser and release branch can be found in the `builds` directory.

For more information, see [Contributing](./CONTRIBUTING.md#setup).

## Third-Party Libraries

Yomitan uses several third-party libraries to function.

<!-- The following table is generated using the command `npm run license-report:markdown`. -->

| Name                | License type | Link                                                                   |
| :------------------ | :----------- | :--------------------------------------------------------------------- |
| @resvg/resvg-wasm   | MPL-2.0      | git+ssh://git@github.com/yisibl/resvg-js.git                           |
| @zip.js/zip.js      | BSD-3-Clause | git+https://github.com/gildas-lormeau/zip.js.git                       |
| dexie               | Apache-2.0   | git+https://github.com/dexie/Dexie.js.git                              |
| dexie-export-import | Apache-2.0   | git+https://github.com/dexie/Dexie.js.git                              |
| hangul-js           | MIT          | git://github.com/e-/Hangul.js.git                                      |
| kanji-processor     | n/a          | https://registry.npmjs.org/kanji-processor/-/kanji-processor-1.0.2.tgz |
| parse5              | MIT          | git://github.com/inikulin/parse5.git                                   |
| yomitan-handlebars  | MIT          | n/a                                                                    |
| linkedom            | ISC          | git+https://github.com/WebReflection/linkedom.git                      |

## Attribution

`fallback-bloop.mp3` is provided by [UNIVERSFIELD](https://pixabay.com/sound-effects/error-8-206492/) and licensed under the [Pixabay Content License](https://pixabay.com/service/license-summary/).
