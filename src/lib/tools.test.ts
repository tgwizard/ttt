import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTool } from "./tools.ts";

test("set replaces everything", () => {
  assert.deepEqual(applyTool("old", "set", { content: "new" }), { ok: true, doc: "new", message: "Document set (3 chars)." });
});

test("append adds to the end", () => {
  const r = applyTool("a", "append", { text: "\n\nb" });
  assert.ok(r.ok && r.doc === "a\n\nb");
});

test("replace requires exactly one match", () => {
  assert.ok(!applyTool("a b a", "replace", { old: "a", new: "x" }).ok);
  assert.ok(!applyTool("a b a", "replace", { old: "z", new: "x" }).ok);
  const r = applyTool("a b a", "replace", { old: "b", new: "x" });
  assert.ok(r.ok && r.doc === "a x a");
});

test("replace with all replaces every occurrence", () => {
  const r = applyTool("a b a", "replace", { old: "a", new: "x", all: true });
  assert.ok(r.ok && r.doc === "x b x");
});

test("replace with empty new deletes", () => {
  const r = applyTool("keep drop keep", "replace", { old: " drop", new: "" });
  assert.ok(r.ok && r.doc === "keep keep");
});

test("unknown tool and bad args are errors", () => {
  assert.ok(!applyTool("", "nope", {}).ok);
  assert.ok(!applyTool("", "set", {}).ok);
  assert.ok(!applyTool("x", "replace", { old: "", new: "y" }).ok);
});
