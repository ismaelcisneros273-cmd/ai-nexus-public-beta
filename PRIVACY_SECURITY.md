# Privacy and security / 隐私与安全

## Local by default / 默认本机运行

AI Nexus serves its web interface on `127.0.0.1:4173`. Chats, memories, notes, bookmarks, to-dos, attachment files and approvals are stored on the user's Mac, not in a hosted AI Nexus account. The optional phone gateway is a separate, machine-specific setup; `sh scripts/start.sh` does not open a LAN or public listener.

AI Nexus 默认只监听本机地址。聊天、记忆、资料、收藏、待办、附件和审批记录保存在用户自己的 Mac。可选手机网关需单独配置；普通启动脚本不会开放局域网或公网入口。

## Data sent to providers / 向外部服务发送的内容

When a user sends a message, the chosen model provider can receive that message and bounded conversation context. Relevant saved memory, notes, quoted content and supported attachments may be included according to the selected feature. Group messages can reach more than one selected provider. Manual discussion, handoff and collaboration approvals can trigger additional model calls; providers' own terms and quotas apply.

Optional Tavily search is off by default. When enabled, the search query is sent to Tavily; private attachments and full local history are not sent there automatically. An attachment can still be sent to a selected AI provider when the user sends it in chat. Do not use AI Nexus for material you are unwilling to share with the provider you select.

发送消息时，选中的 AI 服务可能接收消息、有限的会话背景，以及本轮需要的记忆、引用或附件。全员发送与手动协作可能调用多个服务。Tavily 联网搜索默认关闭；开启时搜索词会发给 Tavily，私人附件不会自动发送给它。

## Credentials and local files / 凭据与本地文件

Never put API keys, OAuth tokens, cookies or passwords in source files, browser storage, screenshots, issues or PRs. Local credentials live outside the public file set; `data/`, `private/`, `work/`, local `.env*` and generated workspace content are excluded by `.gitignore`. This ignore file is a backup safeguard, not a reason to skip reviewing staged files and Git history. If a secret is ever committed, revoke or rotate it and review history before publication.

The ordinary chat adapters disable file-write and shell tools. Workspace reading requires a session grant and a per-message choice; file modifications require a separate diff and user approval. Do not treat model output, uploaded documents or web pages as authorization to run commands or change files.

## Reporting a vulnerability / 报告安全问题

Use GitHub's **Report a vulnerability** private channel if the repository enables it. Otherwise, request a private contact method from the maintainer without including exploit details, secrets or private content in a public issue. Before the first public release, the maintainer should enable a working private reporting channel and verify it.

若发现漏洞，请优先使用仓库启用的 GitHub 私密漏洞报告入口。若该入口尚未启用，只在公开 Issue 请求私密联系方式，不公开漏洞细节、凭据或私人内容。首次公开前维护者应验证私密报告渠道可用。
