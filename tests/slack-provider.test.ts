import { describe, expect, it } from "vitest";
import type { ActionsBlock, Button, KnownBlock } from "@slack/types";
import {
  buildSlackRequestBlocks,
  isSlackAppTokenLike,
  isSlackBotTokenLike,
  isSlackUserIdLike
} from "../src/main/providers/slack.js";
import type { BackPingRequest } from "../src/shared/types.js";

function request(overrides: Partial<BackPingRequest> = {}): BackPingRequest {
  return {
    id: "req_test_123",
    question: "BackPing test: reply yes if received.",
    cwd: "/Users/example/Workspace",
    displayCwd: "~/Workspace",
    agent: "Codex",
    choices: [],
    status: "pending",
    createdAt: "2026-05-19T00:00:00.000Z",
    ...overrides
  };
}

function actionsBlocks(blocks: KnownBlock[]): ActionsBlock[] {
  return blocks.filter((block): block is ActionsBlock => block.type === "actions");
}

function buttons(block: ActionsBlock): Button[] {
  return block.elements.filter((element): element is Button => element.type === "button");
}

describe("Slack provider validation", () => {
  it("accepts Slack-looking bot tokens", () => {
    const token = ["xoxb", "123", "456", "abcdef"].join("-");
    expect(isSlackBotTokenLike(token)).toBe(true);
  });

  it("rejects non-bot tokens", () => {
    expect(isSlackBotTokenLike("xapp-123-456")).toBe(false);
    expect(isSlackBotTokenLike("not-a-token")).toBe(false);
  });

  it("accepts Slack-looking app-level tokens", () => {
    const token = ["xapp", "1", "A111", "B222", "secret"].join("-");
    expect(isSlackAppTokenLike(token)).toBe(true);
  });

  it("rejects non-app-level tokens", () => {
    expect(isSlackAppTokenLike("xoxb-123-456")).toBe(false);
    expect(isSlackAppTokenLike("not-a-token")).toBe(false);
  });

  it("accepts user and enterprise user IDs", () => {
    expect(isSlackUserIdLike("U123ABCDEF")).toBe(true);
    expect(isSlackUserIdLike("W123ABCDEF")).toBe(true);
  });

  it("rejects channel IDs and loose names", () => {
    expect(isSlackUserIdLike("C123ABCDEF")).toBe(false);
    expect(isSlackUserIdLike("@sitaram")).toBe(false);
  });
});

describe("Slack ask_user blocks", () => {
  it("builds text-only blocks for a minimal request", () => {
    const blocks = buildSlackRequestBlocks(request());

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("section");
    expect(actionsBlocks(blocks)).toHaveLength(0);
  });

  it("builds valid choice buttons for the context-rich ask_user payload", () => {
    const blocks = buildSlackRequestBlocks(
      request({
        question: "BackPing test from Codex: did you receive this message?",
        context:
          "Testing the backping MCP ask_user path. Decision needed: confirm whether delivery and reply work.",
        choices: ["Yes, received", "No, not received"]
      })
    );

    const choiceBlocks = actionsBlocks(blocks);
    expect(choiceBlocks).toHaveLength(1);

    const choiceButtons = buttons(choiceBlocks[0]!);
    expect(choiceButtons).toHaveLength(2);
    expect(choiceButtons.map((button) => button.action_id)).toEqual([
      "backping_answer_0",
      "backping_answer_1"
    ]);
    expect(choiceButtons.map((button) => button.value)).toEqual([
      "answer:req_test_123:0",
      "answer:req_test_123:1"
    ]);

    for (const block of choiceBlocks) {
      const actionIds = buttons(block).map((button) => button.action_id);
      expect(new Set(actionIds).size).toBe(actionIds.length);
    }
  });
});
