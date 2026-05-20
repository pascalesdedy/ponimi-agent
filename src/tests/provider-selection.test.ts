import test from "node:test";
import assert from "node:assert/strict";
import { selectProvider } from "../llm/provider";

test("selectProvider uses configured provider when key exists", () => {
  assert.equal(
    selectProvider("openai", { openai: "x", deepseek: "y" }),
    "openai"
  );
});

test("selectProvider falls back to available provider", () => {
  assert.equal(
    selectProvider("openai", { deepseek: "x" }),
    "deepseek"
  );
});

test("selectProvider throws when no keys configured", () => {
  assert.throws(() => selectProvider("deepseek", {}), /No LLM API key configured/);
});

