import test from "node:test";
import assert from "node:assert/strict";
import { assertValidTicketId, sanitizePromptText, sanitizeTargetUrl, validateTicketId } from "../security/input";

test("validateTicketId accepts safe IDs", () => {
  assert.equal(validateTicketId("AUTH-123"), true);
  assert.equal(validateTicketId("QA_001"), true);
});

test("validateTicketId rejects traversal and invalid chars", () => {
  assert.equal(validateTicketId("../../etc/passwd"), false);
  assert.equal(validateTicketId("bad ticket"), false);
});

test("assertValidTicketId throws on invalid ticket", () => {
  assert.throws(() => assertValidTicketId("../evil"), /Invalid ticketId/);
});

test("sanitizePromptText strips controls and trims", () => {
  const out = sanitizePromptText(" hello \n\t world\u0000 ");
  assert.equal(out, "hello world");
});

test("sanitizeTargetUrl allows only http/https", () => {
  assert.equal(sanitizeTargetUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(sanitizeTargetUrl("file:///etc/passwd"), "");
});

