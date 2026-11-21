# Privacy and security

[Back to README](README.md) · [Report a vulnerability](SECURITY.md)

## Local by default, not offline by definition

The normal AI Nexus service listens on `127.0.0.1:4173`. Conversations, saved memory, notes, bookmarks, to-dos, attachments, and approval records are stored on your Mac. There is no required hosted AI Nexus account or database. The optional phone HTTPS gateway is separate and is **not** started by `sh scripts/start.sh`.

Sending a chat message to a provider sends that message and bounded relevant conversation context to the selected provider. Depending on the feature, saved memory, quoted content, notes, or supported attachments may also be included. A group send or approved collaboration can contact multiple providers. Each provider's privacy terms, eligibility, usage limits, and charges apply. Do not send material you are unwilling to share with the provider you select.

Optional Tavily search is off by default. When enabled, a search query is sent to Tavily; private attachments and the entire local chat history are not automatically sent to it. Attached content may still be sent to a chosen AI provider when you submit a message.

## Credentials and local files

Do not put API keys, OAuth tokens, cookies, or passwords in source files, browser storage, screenshots, issue reports, or pull requests. Runtime `data/`, `private/`, `work/`, local `.env*`, generated workspace content, and personal configuration are excluded from the public file set. `.gitignore` is a safety net, not a substitute for reviewing staged files and Git history. If a secret was committed, revoke or rotate it and review the history before publishing.

Ordinary chat adapters disable shell and file-write tools. Workspace reading needs a session grant and per-message selection. A proposed single-file change needs its own diff preview and explicit approval. Model output, uploaded documents, and web pages are untrusted content, never authorization to run commands or change files. Project test/build command execution remains disabled in this beta.

For vulnerabilities, use the repository's private GitHub reporting feature when available; otherwise request a private contact channel without public exploit details. See [SECURITY.md](SECURITY.md).
