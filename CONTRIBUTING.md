# Contributing to AI Nexus

[Read the product overview](README.md) · [First reply guide](docs/GETTING_STARTED.md) · [Security policy](SECURITY.md)

AI Nexus is an early, local-first macOS project. The most helpful contributions are focused fixes, clearer first-run guidance, small accessibility improvements, and tests that reproduce a real problem. Please avoid adding a second workflow for an existing feature or expanding model permissions without a clear user need and review.

## Before opening an issue

Search existing issues. Include the behavior you expected, what happened, macOS and Node.js versions, and safe steps to reproduce. Say whether a result came from a mock test or a real provider call. A connected badge does not prove that a model replied.

Use invented data. Never attach credentials, OAuth responses, cookies, personal chats, uploaded files, private paths, or unredacted logs. For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of posting exploit details in a public issue.

## A small pull request is easier to review

1. Fork or branch from the current `main`. Keep one change focused on one problem.
2. Run `npm run check` and `npm test`. The test suite uses isolated mocks and is not intended to call paid models or Tavily.
3. Describe what a user can now do, how you verified it, and what still needs a real Mac, Safari, or provider account.
4. Preserve local data, authorization checks, and the default `127.0.0.1` binding. Do not add a model call, file write, shell permission, or network listener as a side effect.
5. If you add code, media, or data from elsewhere, record its source and license. Keep third-party copyright notices; do not relicense their files as project-original MIT work.

Contributors should submit only material they have the right to contribute under the project's MIT license. Provider names and trademarks remain their owners' property. See [SOURCES_AND_LICENSES.md](SOURCES_AND_LICENSES.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
