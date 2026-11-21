# Draft release copy: AI Nexus v0.1.0 Public Beta

**Status:** Editorial draft for the already-published v0.1.0 release. This file does not move the tag, publish another release, or change the live GitHub release notes.

## Meet AI Nexus

**Tell it once. Every AI knows.** AI Nexus is a local-first conversation space for using several AI tools on one Mac. Keep a shared thread, choose who responds, and invite a second perspective without copying the whole conversation into another app.

## In this beta

- One local chat history with per-message recipient choice, `@` mentions, quotes, search, pinning, bookmarks, and to-dos.
- Manual group discussion, one-time handoff, AI-proposed collaboration with explicit approval, and an optional final synthesis. No automatic agent loop.
- Saved memory and bounded history context, supported file and image attachments, and optional Tavily-backed web search.
- Session-scoped workspace reading and a single-file change proposal with diff review and approval. Ordinary chat cannot write files or run shell commands; project test/build execution is disabled.
- macOS-first local startup with no npm runtime dependencies in this snapshot.

## Try it

Install a supported Node.js version, then follow the [quick start](../README.md#quick-start). For a first real reply, sign in through an official Claude Code CLI or the official ChatGPT macOS app's bundled Codex App Server, restart Nexus, and choose a member shown as connected. Provider access and usage limits are separate. See the [first reply guide](GETTING_STARTED.md).

## Know before you use it

This is an early beta, not a hosted service. Chats and attachments are stored locally, but selected messages and context are sent to the AI provider you choose. The separate ChatGPT member lacks a visible first-time authorization control in this release; DeepSeek is paused by default and needs its own paid API balance; Muse cannot reply. A clean Mac with a new user's account has not yet been independently verified end to end. Windows and Linux are unverified. The phone HTTPS gateway requires separate device-specific setup.

Mock-based tests and macOS CI cover startup prerequisites, syntax, and isolated behavior. They do not prove a provider will answer with your account.

## Help improve it

Small focused fixes, first-run reports, and reproducible tests are welcome. See [Contributing](../CONTRIBUTING.md). Please keep credentials, chats, and unredacted logs out of public issues. Report vulnerabilities through the repository's private reporting path when available; see [Security](../SECURITY.md). Project-owned material is offered under MIT; bundled third-party files retain their own notices.
