# From a fresh Mac to a first reply

[Back to the product overview](../README.md)

AI Nexus is an early macOS Public Beta. A completely fresh Mac and a new user's own provider account have not yet been independently verified end to end. These steps describe the supported path and its checks; they do not promise provider access or free usage.

## 1. Prepare the Mac

Install Node.js from [the official Node.js download page](https://nodejs.org/en/download/). Use 22.21.0 or newer on the 22.x line, or 24.x / a newer even-numbered LTS release. In Terminal, run `node -v` to check. AI Nexus uses `--use-env-proxy`, which is why older Node 22 releases are not supported. The startup script checks this for you.

Clone the repository and launch it:

```sh
git clone https://github.com/ismaelcisneros273-cmd/ai-nexus-public-beta.git
cd ai-nexus-public-beta
sh scripts/start.sh
```

A ZIP download works too: enter the extracted folder containing `package.json`, then run `sh scripts/start.sh`. No `npm install` is needed for this dependency-free snapshot. The script does not install software, change global settings, or stop another service on the port.

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/) on **that Mac**. Keep the Terminal window open. Press Control-C to stop.

## 2. Connect one real member

Open **AI members** in the sidebar or **Members & status** next to the recipient selector. The status comes from the local server. A program found on disk is not the same as a signed-in, working model.

**Claude / Claude Code:** Follow the official [Claude Code setup guide](https://code.claude.com/docs/en/setup), launch `claude` in Terminal, and complete Anthropic's own sign-in. You can check the CLI with `claude auth status`. Restart Nexus after installing or signing in. Select **Claude** or **Claude Code**, which are distinct visible roles backed by the **same CLI and account allowance**. Type a short message and send. Ordinary chat disables Claude Code tools.

**Codex:** Install and sign in to the official [ChatGPT macOS app](https://chatgpt.com/download/). Restart Nexus. Select **Codex** if the status says connected. This release looks for the app-bundled Codex App Server at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`; app updates or alternate installation paths can break detection. Codex is not the separate ChatGPT chat member. Chat tool approvals are denied.

A real response may use the provider's subscription allowance, credits, or paid API balance according to that provider's terms. AI Nexus makes no model request merely because you open the page or check status.

## 3. If it does not work

- **Unsupported Node.js:** install a supported version from Node's official site; the script will not do this automatically.
- **Port 4173 already in use:** use the existing local Nexus page if it is yours. The script will not kill the other process.
- **Member offline:** complete official installation/login, restart Nexus, then check status again. Do not copy OAuth files, browser cookies, or another installation's credentials.
- **Member connected but no reply:** read the error shown in the chat. Account eligibility, usage limits, network access, and provider availability are separate from the connection check.
- **ChatGPT member:** the independent Sign in with ChatGPT backend exists, but this beta has no visible first-time authorization control. Do not treat Codex as a substitute or use an unofficial bridge.
- **DeepSeek:** paused by default and requires its own paid cloud API balance. It is not needed for the first reply.
- **Muse:** display-only and cannot reply.

Do not expose the local port to a network. The optional phone gateway is a separate, machine-specific setup that this start script does not enable. See [Privacy & security](../PRIVACY_SECURITY.md) before sending sensitive context to an external model.

Developers can run `npm run check` and `npm test`. These use syntax checks and isolated mock tests, not real AI calls.
