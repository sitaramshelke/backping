# BackPing

BackPing is a local tray app for one narrow job: helping local coding agents avoid getting stuck when they need human input.

It exposes a localhost MCP server for MCP-capable agents such as Codex CLI, Codex desktop, Claude Code, Claude desktop, and other clients that can use Streamable HTTP MCP. When an agent calls `ask_user`, BackPing sends the question to Telegram or Slack, waits for your answer, and returns that answer to the agent.

BackPing does not execute commands, start agents, stream logs, or provide remote terminal access.

## Download

Download the latest unsigned build for your OS from [GitHub Releases](https://github.com/sitaramshelke/backping/releases/latest).

- macOS Apple Silicon: [BackPing-latest-arm64.dmg](https://github.com/sitaramshelke/backping/releases/latest/download/BackPing-latest-arm64.dmg)
- Windows x64: [BackPing-latest-windows-x64.exe](https://github.com/sitaramshelke/backping/releases/latest/download/BackPing-latest-windows-x64.exe)

These builds are unsigned. macOS may warn on first launch; for a trusted local build, use right-click, then Open. Windows may show SmartScreen warnings; use these Windows builds for testing until they have more real-machine coverage.

## Status

This is an early V1 for local testing and small-team sharing.

Implemented:

- Electron tray/menu-bar app.
- Local Streamable HTTP MCP endpoint on `127.0.0.1`.
- Bearer-token auth for MCP.
- Telegram provider using long polling.
- `/start` setup flow that learns your Telegram chat.
- Slack provider using Socket Mode, with answers routed through Slack threads.
- One active messaging provider at a time.
- Multiple concurrent pending questions.
- Inline Telegram buttons for choices.
- Slack Block Kit buttons for choices.
- Reply-to-message answer routing.
- Local JSON request history.
- Electron `safeStorage`-backed local secret storage for Telegram and Slack tokens, with legacy macOS Keychain migration.
- Copyable MCP config and agent instruction snippets.
- Optional launch-at-login startup.
- Unsigned macOS app/DMG packaging.
- Unsigned Windows installer packaging.

Deferred:

- Stdio MCP wrapper.
- Signed/notarized releases.
- Automatic MCP config editing.

## Logo

BackPing uses an Agent Plane mark: an AI agent inside a message bubble sending a paper-plane message.

![BackPing logo](assets/icon/app-icon.png)

## Requirements

- macOS or Windows.
- Node.js and npm.
- A Telegram account or Slack workspace access.
- An MCP client that supports Streamable HTTP, such as Codex CLI, Codex desktop, Claude Code, Claude desktop, or another compatible agent client.

## Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Check types:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Verify icon assets and refresh the README/GitHub Pages PNG plus Windows ICO derived from the app icon. This helper currently requires macOS because it uses `sips`; the generated assets are committed for Windows builds:

```bash
npm run icons
```

Build the unsigned app:

```bash
npm run package:mac
```

Build an unsigned DMG:

```bash
npm run dmg
```

Build an unsigned Windows installer:

```bash
npm run package:win
```

The packaged output is written under `release/`.

## Telegram Setup

1. Open Telegram and message `@BotFather`.
2. Send `/newbot` and create a bot.
3. Copy the bot token.
4. Open BackPing settings.
5. Paste the token into the Telegram section and save.
6. Open your new bot in Telegram and send `/start`.
7. BackPing stores that chat as the only allowed chat.

BackPing ignores messages from other Telegram chats.

## Slack Setup

Slack is useful on work laptops where Slack is allowed but Telegram Bot API traffic is blocked. BackPing uses Slack Socket Mode, so it does not need a public URL or any inbound network port.

Use a separate Slack app per person. That keeps each user's agent questions private to their own Slack bot and local BackPing daemon. Do not share Slack app tokens across teammates.

The fastest setup is the reusable manifest in `slack-app-manifest.example.json`:

1. Copy `slack-app-manifest.example.json`.
2. Replace `your-name` in `display_information.name` and `features.bot_user.display_name`.
3. Use a recognizable personal name, such as `BackPing - Your Name` for the app name and `backping-your-name` for the bot display name. Slack bot display names should stay lowercase and avoid spaces.
4. Open [Slack Apps](https://api.slack.com/apps), click `Create New App`, then choose `From an app manifest`.
5. Paste the edited manifest and create the app.
6. Open `Settings > Basic Information`, scroll down to `App-Level Tokens`, then click `Generate Token and Scopes`.
7. Name the token something like `BackPing Local`, add the `connections:write` scope, then generate and copy the token starting with `xapp-`.
8. Install the app to the workspace and copy the Bot User OAuth Token starting with `xoxb-` from `OAuth & Permissions`.
9. Copy your Slack user ID: in Slack, open your profile, click `More`, then click `Copy member ID`. It usually looks like `U123ABCDEF`.
10. Open BackPing settings, save the Slack bot token, app-level token, and user ID.
11. Click `Test Connection`, then set the provider to `Slack` and save.

BackPing opens a DM with your user and only accepts messages or button clicks from that Slack user ID.

For Slack, each agent question is a parent DM message. Answer by replying in that message thread, or use the choice buttons. Top-level DM replies are not used to answer questions, which keeps concurrent requests easier to follow.

## Agent MCP Setup

In BackPing settings, use the two buttons in `Connect Agents`:

- `Copy MCP Config`: paste this into the user-level MCP config for your agent client. Use user-level config so the same BackPing server is available across parallel sessions and desktop/CLI variants.
- `Copy Agent Memory Instruction`: paste this into Codex memory, Claude memory, personal instructions, or a user-level agent instruction file so agents remember to install BackPing in the user-level MCP config and use it only when you are unavailable and a decision would otherwise block progress.
- `Launch at login`: enable this if you want BackPing to start automatically after a computer restart or sign-in. It starts quietly in the tray/menu bar without opening settings.

Example:

```toml
[mcp_servers.backping]
url = "http://127.0.0.1:47832/mcp"
tool_timeout_sec = 1800
enabled = true

[mcp_servers.backping.http_headers]
Authorization = "Bearer LOCAL_TOKEN"
```

Agent memory instruction:

```md
Remember this for future work:

BackPing should be installed as a user/global MCP server using BackPing's copied MCP config, not only in project-local or current-session config. Configure it at the user level for whichever MCP client is being used so it is available across parallel sessions and desktop/CLI variants.

Behavior rule:
Use BackPing (`mcp__backping__.ask_user` / `backping.ask_user`) whenever I am unavailable, away from keyboard, or explicitly ask you to wait and ask me later. Availability signals include lunch, dinner, AFK, away from keyboard, going out, commuting, in a meeting, stepping away, or "wait then ask me".

If I am actively present in the current interactive session, ask there instead of using BackPing.

Use `ask_user` in `wait` mode when my answer blocks progress. Use `async` mode when the task can continue or when I simply asked to be asked later. Do not just sleep and post the question in chat when I said I am away.

When using BackPing:
- Keep the question concise.
- Include the current working directory in the `cwd` field when relevant.
- Explain the decision needed in the `context` field.
- Provide choices when possible.
- Avoid sensitive details unless required.
- If BackPing is unavailable, say so in chat and leave the question there as fallback.
```

## MCP Tools

BackPing exposes these tools:

- `ask_user`: ask a question and optionally wait for the answer.
- `notify_user`: send a one-way message.
- `get_status`: return BackPing status.
- `list_pending_requests`: show pending requests.
- `cancel_request`: cancel a pending request.

`ask_user` accepts:

```json
{
  "question": "Should I update the migration or adjust the fixture?",
  "cwd": "/Users/you/Workspace/example",
  "agent": "Agent",
  "context": "The current test failure can be fixed in either place.",
  "choices": ["Update migration", "Adjust fixture", "Stop and wait"],
  "timeout_seconds": 1800,
  "mode": "wait"
}
```

## Manual Test Path

1. Run `npm run dev`.
2. Configure Telegram or Slack in settings.
3. Set the active provider and save.
4. Copy the MCP config from settings into your user-level agent/MCP client config.
5. Ask an MCP-capable agent to call `backping.ask_user` with the current `cwd`.
6. Answer in Telegram, or answer in the Slack question thread.
7. Confirm the MCP call returns and the agent continues.

To test concurrent requests, start two MCP calls before answering either one. In Telegram, reply to each question message or use the inline buttons. In Slack, answer in each question thread or use the buttons.

## Packaging Notes

`npm run dmg` creates an unsigned DMG. This is fine for local testing and small-team sharing, but macOS may show a Gatekeeper warning on first launch, especially on another Mac. Use right-click, then Open, for trusted builds.

`npm run package:win` creates an unsigned Windows installer from macOS via electron-builder, plus `BackPing-latest-windows-x64.exe` for stable release downloads. Windows may show SmartScreen warnings for unsigned builds, and each Windows build should be tested on a real Windows machine or VM before sharing widely.

A smoother external install would require Developer ID signing and notarization, but that is intentionally outside V1.

## GitHub Pages

The static project site lives in `docs/`. To publish it, push the repository to GitHub, open repository settings, enable Pages from the `main` branch, and choose `/docs` as the source folder.

## Security Model

BackPing is intentionally narrow:

- It binds MCP only to `127.0.0.1`.
- It requires a local bearer token for MCP calls.
- It stores Telegram and Slack tokens in Electron `safeStorage`-backed local secret storage.
- It only accepts Telegram messages from the chat that completed `/start`.
- It only accepts Slack messages and interactions from the configured Slack user ID.
- It never opens a shell, PTY, or job runner.
- It does not provide remote terminal control.

Keep Telegram and Slack tokens private.
