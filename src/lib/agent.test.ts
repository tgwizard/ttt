import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUserMessage, type Utterance } from "./agent.ts";

const u = (id: number, text: string, status: Utterance["status"]): Utterance => ({ id, text, at: 0, status });

test("prompt is handled transcript, then document, then new speech", () => {
  const { stable, rest } = buildUserMessage([u(1, "first", "handled"), u(2, "second", "pending"), u(3, "third", "new")], "# Doc");
  assert.equal(stable, "<earlier_speech>\n[handled] first\n</earlier_speech>\n\n");
  assert.equal(rest, "<document>\n# Doc\n</document>\n\n<new_speech>\n[pending] second\nthird\n</new_speech>");
});

test("questions the model asked appear in the transcript", () => {
  const { stable } = buildUserMessage([u(1, "insert an image", "handled"), { ...u(2, "Which image?", "handled"), role: "assistant" }], "");
  assert.ok(stable.includes("[handled] insert an image\n[you asked] Which image?"));
});

test("the whole transcript is included, and appending keeps the prefix", () => {
  const many = Array.from({ length: 40 }, (_, i) => u(i, `said ${i}`, "handled"));
  const before = buildUserMessage(many, "doc").stable;
  const after = buildUserMessage([...many, u(40, "said 40", "handled")], "doc").stable;
  assert.ok(before.includes("said 0") && before.includes("said 39"));
  const prefix = before.slice(0, before.indexOf("</earlier_speech>"));
  assert.ok(after.startsWith(prefix));
});
