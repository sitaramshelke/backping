import { describe, expect, it } from "vitest";
import { isTelegramBotTokenLike } from "../src/main/providers/telegram.js";

describe("Telegram token validation", () => {
  it("accepts BotFather-shaped tokens", () => {
    expect(isTelegramBotTokenLike("123456789:ABCdef_123-456")).toBe(true);
  });

  it("rejects empty or malformed tokens", () => {
    expect(isTelegramBotTokenLike("")).toBe(false);
    expect(isTelegramBotTokenLike("not-a-token")).toBe(false);
    expect(isTelegramBotTokenLike("123456789")).toBe(false);
  });
});
