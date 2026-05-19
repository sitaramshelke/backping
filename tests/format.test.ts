import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { agentInstructionSnippet, codexConfigSnippet, shortenCwd } from "../src/shared/format.js";

describe("format helpers", () => {
  it("shortens home-relative directories", () => {
    expect(shortenCwd(`${homedir()}/Workspace/backping`)).toBe("~/Workspace/backping");
  });

  it("generates Codex config with static authorization header", () => {
    const snippet = codexConfigSnippet(47832, "token-123");
    expect(snippet).toContain("[mcp_servers.backping.http_headers]");
    expect(snippet).toContain('Authorization = "Bearer token-123"');
  });

  it("keeps agent instructions scoped to human input", () => {
    const snippet = agentInstructionSnippet();
    expect(snippet).toContain("BackPing should be configured as a user/global MCP server");
    expect(snippet).toContain("mcp__backping__.ask_user");
    expect(snippet).toContain("wait then ask me");
    expect(snippet).toContain("Do not just sleep and post the question in chat");
    expect(snippet).toContain("Use `ask_user` in `wait` mode");
    expect(snippet).toContain("Use `async` mode");
    expect(snippet).toContain("Include the current working directory in the `cwd` field");
    expect(snippet).toContain("If BackPing is unavailable, say so in chat");
    expect(snippet).toContain("ask there instead of using BackPing");
    expect(snippet).toContain("user/global MCP server");
    expect(snippet).toContain("Codex CLI, Codex desktop, Claude Code, and Claude desktop");
    expect(snippet).toContain("parallel agent sessions");
  });
});
