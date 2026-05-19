# Security Policy

BackPing is intentionally narrow: it lets local MCP clients ask the configured user for input over Telegram or Slack. It must not execute commands, open a terminal, start agents, stream logs, or provide remote control of the machine.

## Supported Versions

BackPing is pre-1.0. Security fixes should target the current `main` branch.

## Reporting a Vulnerability

Please do not open public issues for vulnerabilities that expose tokens, allow unauthorized message routing, bypass local MCP bearer auth, or expand BackPing into command execution. Use GitHub's private vulnerability reporting flow for this repository: https://github.com/sitaramshelke/backping/security/advisories/new.

Include the affected version or commit, reproduction steps, expected impact, and whether any local tokens or chat routes may have been exposed.

## Local Security Model

- MCP binds only to `127.0.0.1`.
- MCP requires a local bearer token.
- Telegram and Slack tokens are stored in macOS Keychain.
- Telegram replies are accepted only from the configured chat.
- Slack replies and button clicks are accepted only from the configured Slack user ID.
- BackPing never executes code or shell commands from chat.
