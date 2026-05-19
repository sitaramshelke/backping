# BackPing Agent Notes

## Project Goal

BackPing is a local macOS menu-bar app that lets local coding agents ask the human for input through Telegram or Slack. It must stay a request/answer bridge only.

Hard boundaries:

- Do not add remote shell or PTY access.
- Do not start Codex, Claude, or any other agent from Telegram.
- Do not execute arbitrary commands from chat.
- Do not stream terminal logs or screenshots.
- Do not make chat providers capable of running commands or controlling agents.

## Commands

Install:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Typecheck:

```bash
npm run typecheck
```

Test:

```bash
npm test
```

Convert the top-level PNG mockup crops into macOS app and menu-bar icon assets:

```bash
npm run icons
```

Package unsigned app:

```bash
npm run package:mac
```

Build unsigned DMG:

```bash
npm run dmg
```

## Implementation Notes

- Main process code lives under `src/main`.
- Shared types and formatting helpers live under `src/shared`.
- Keep core request lifecycle independent from Electron so it remains easy to test.
- Store non-secret settings/history in local JSON through Electron Store.
- Store Telegram and Slack tokens in macOS Keychain through the `security` CLI wrapper.
- MCP must bind only to `127.0.0.1` and require bearer auth.
- Telegram must support multiple simultaneous pending requests.
- Slack must support multiple simultaneous pending requests by requiring answers in the relevant question thread or through Block Kit buttons.
- Slack setup should stay per-user. Keep `slack-app-manifest.example.json` as a personal app template and encourage names like `BackPing - Sitaram` / `backping-sitaram`.
- Every agent question should include the current working directory when available.

## Agent Usage Snippet

When developing or testing this repo with Codex, use this behavior:

```md
Remember this for future work:

BackPing should be configured as a user/global MCP server, not only in project-local or current-session config. It must be available across parallel agent sessions in Codex CLI, Codex desktop, Claude Code, and Claude desktop. For Codex, use BackPing's copied MCP config in `~/.codex/config.toml`; for Claude, add the equivalent user/global MCP server entry with the same local URL and Authorization bearer header.

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
