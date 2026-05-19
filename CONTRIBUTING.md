# Contributing

BackPing is intentionally small. Contributions should preserve the core promise: local agents can ask the configured human for input, but chat providers cannot execute commands or control the machine.

## Development

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run package:mac
```

## Scope Guardrails

- Do not add remote shell, PTY, job runner, screenshot streaming, or command execution features.
- Keep MCP bound to `127.0.0.1` and protected by bearer auth.
- Keep Telegram and Slack tokens in macOS Keychain.
- Keep provider setup per user; do not encourage shared Slack or Telegram tokens.
- Keep request routing safe for concurrent questions.

## Website

The GitHub Pages site lives in `docs/`. Keep it static so it can publish directly from the `/docs` folder on the main branch.
