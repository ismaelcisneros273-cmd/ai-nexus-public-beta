# Contributing to AI Nexus / 参与贡献

Thank you for helping make this small local chat workspace easier to use. 欢迎修复明确的问题、改善首次安装体验并补充可靠测试。

## Before opening an issue / 提交问题前

- Search existing issues. Describe what you expected, what happened, macOS and Node.js versions, and safe steps to reproduce.
- Never paste passwords, API keys, OAuth responses, cookies, chat history, attachments, local project files, or unredacted logs. Use a small invented example instead.
- A connected-status badge is not proof that a model answered; explain whether the result came from a mock test or a real provider call.
- For security issues, use GitHub's private vulnerability reporting when available. If unavailable, ask the maintainer for a private channel **without posting exploit details or secrets** in a public issue.

## Pull requests / 提交修改

1. Keep each PR focused. Preserve existing local data and security boundaries; do not broaden the listening address or add model calls without an explicit reason and review.
2. Make changes in your own checkout. Run `npm run check` and `npm test`. These checks use local mocks and do not intentionally call paid models.
3. Explain the user-visible change, tests run, and anything you could not verify on a real Mac or Safari.
4. Use invented test data. Do not include personal screenshots, private paths, credentials, or generated local `data/` and `private/` files.
5. If adding third-party code or media, identify its origin and license and update `THIRD_PARTY_NOTICES.md` where appropriate.

The original project code is offered under MIT (`LICENSE`); bundled third-party files keep their own licenses (`THIRD_PARTY_NOTICES.md`). Contributors should submit only work they have the right to license under MIT. 原创项目代码采用 MIT，第三方文件仍按原许可；请只提交你有权以 MIT 许可贡献的内容。
