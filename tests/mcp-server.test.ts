import { describe, expect, it } from "vitest";
import { isAuthorizedHeader } from "../src/main/mcp-server.js";

describe("MCP auth", () => {
  it("accepts exact bearer token", () => {
    expect(isAuthorizedHeader("Bearer abc", "abc")).toBe(true);
  });

  it("rejects missing or wrong bearer token", () => {
    expect(isAuthorizedHeader(undefined, "abc")).toBe(false);
    expect(isAuthorizedHeader("Bearer wrong", "abc")).toBe(false);
  });
});
