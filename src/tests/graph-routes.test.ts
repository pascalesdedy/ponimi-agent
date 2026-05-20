import test from "node:test";
import assert from "node:assert/strict";
import { routeAfterCsv, routeAfterExecution, routeAfterPlaywright, routeAfterValidation } from "../agent/graph";
import { AgentState } from "../agent/state";

test("routeAfterCsv pauses for manual mode", () => {
  assert.equal(routeAfterCsv({ mode: "manual" } as unknown as AgentState), "__end__");
});

test("routeAfterCsv continues for autonomous mode", () => {
  assert.equal(routeAfterCsv({ mode: "autonomous" } as unknown as AgentState), "generatePlaywright");
});

test("routeAfterPlaywright routes manual to report", () => {
  assert.equal(routeAfterPlaywright({ mode: "manual" } as unknown as AgentState), "reportResults");
});

test("routeAfterValidation blocks unsafe scripts", () => {
  assert.equal(routeAfterValidation({ codeSafe: false } as unknown as AgentState), "reportResults");
});

test("routeAfterExecution retries failed tests when allowed", () => {
  assert.equal(
    routeAfterExecution({
      executionStatus: "failed",
      selfHealDisabled: false,
      retryCount: 1,
    } as unknown as AgentState),
    "generatePlaywright"
  );
});
