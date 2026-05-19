import { homedir } from "node:os";

export function shortenCwd(cwd?: string): string | undefined {
  if (!cwd) {
    return undefined;
  }

  const home = homedir();
  if (cwd === home) {
    return "~";
  }

  if (cwd.startsWith(`${home}/`)) {
    return `~/${cwd.slice(home.length + 1)}`;
  }

  return cwd;
}

export function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 15)}\n[truncated]`;
}

export function formatRequestMessage(request: {
  id: string;
  agent: string;
  displayCwd?: string;
  question: string;
  context?: string;
  choices: string[];
}): string {
  const lines: string[] = [];
  lines.push(`${request.agent} needs input`);
  lines.push("");

  if (request.displayCwd) {
    lines.push("Directory:");
    lines.push(request.displayCwd);
    lines.push("");
  }

  lines.push(`Request: ${request.id}`);
  lines.push("");

  if (request.context) {
    lines.push("Context:");
    lines.push(request.context);
    lines.push("");
  }

  lines.push("Question:");
  lines.push(request.question);

  if (request.choices.length > 0) {
    lines.push("");
    lines.push("Choices:");
    request.choices.forEach((choice, index) => {
      lines.push(`${index + 1}. ${choice}`);
    });
  }

  return lines.join("\n");
}

export function formatNotificationMessage(input: {
  agent?: string;
  cwd?: string;
  context?: string;
  message: string;
}): string {
  const lines: string[] = [];
  lines.push(`${input.agent ?? "Agent"} notification`);
  lines.push("");

  const displayCwd = shortenCwd(input.cwd);
  if (displayCwd) {
    lines.push("Directory:");
    lines.push(displayCwd);
    lines.push("");
  }

  if (input.context) {
    lines.push("Context:");
    lines.push(input.context);
    lines.push("");
  }

  lines.push(input.message);
  return lines.join("\n");
}

export function codexConfigSnippet(port: number, authToken: string): string {
  return [
    "[mcp_servers.backping]",
    `url = "http://127.0.0.1:${port}/mcp"`,
    "tool_timeout_sec = 1800",
    "enabled = true",
    "",
    "[mcp_servers.backping.http_headers]",
    `Authorization = "Bearer ${authToken}"`,
    ""
  ].join("\n");
}

export function agentInstructionSnippet(): string {
  return [
    "Remember this for future work:",
    "",
    "BackPing should be configured as a user/global MCP server, not only in project-local or current-session config. It must be available across parallel agent sessions in Codex CLI, Codex desktop, Claude Code, and Claude desktop. For Codex, use BackPing's copied MCP config in `~/.codex/config.toml`; for Claude, add the equivalent user/global MCP server entry with the same local URL and Authorization bearer header.",
    "",
    "Behavior rule:",
    "Use BackPing (`mcp__backping__.ask_user` / `backping.ask_user`) whenever I am unavailable, away from keyboard, or explicitly ask you to wait and ask me later. Availability signals include lunch, dinner, AFK, away from keyboard, going out, commuting, in a meeting, stepping away, or \"wait then ask me\".",
    "",
    "If I am actively present in the current interactive session, ask there instead of using BackPing.",
    "",
    "Use `ask_user` in `wait` mode when my answer blocks progress. Use `async` mode when the task can continue or when I simply asked to be asked later. Do not just sleep and post the question in chat when I said I am away.",
    "",
    "When using BackPing:",
    "- Keep the question concise.",
    "- Include the current working directory in the `cwd` field when relevant.",
    "- Explain the decision needed in the `context` field.",
    "- Provide choices when possible.",
    "- Avoid sensitive details unless required.",
    "- If BackPing is unavailable, say so in chat and leave the question there as fallback."
  ].join("\n");
}
