import { StateGraph, END, START } from "@langchain/langgraph";
import { execSync } from "child_process";
import { AgentStateAnnotation, AgentState } from "./state";
import { extractRequirements } from "./nodes/extractRequirements";
import { generateCsv } from "./nodes/generateCsv";
import { generatePlaywright } from "./nodes/generatePlaywright";
import { executeTest } from "./nodes/executeTest";
import { reportResults } from "./nodes/reportResults";
import { checkpointer } from "../db/sqlite";

/** Cached check: is Playwright installed on this machine? */
let _pwAvailable: boolean | null = null;
function isPlaywrightAvailable(): boolean {
  if (_pwAvailable !== null) return _pwAvailable;
  try {
    execSync("npx playwright --version 2>/dev/null", { timeout: 5000, encoding: "utf-8" });
    _pwAvailable = true;
  } catch {
    _pwAvailable = false;
  }
  return _pwAvailable;
}

/**
 * Route after CSV generation:
 * - Manual mode: pause for human review
 * - Semi-autonomous: pause for CSV review
 * - Autonomous: skip directly to Playwright generation
 */
const routeAfterCsv = (state: AgentState): string => {
  if (state.mode === "autonomous") {
    return "generatePlaywright";
  }
  // Manual & Semi both pause for review
  return END;
};

/**
 * Route after test execution:
 * - 'passed' or 'skipped' → report results (no self-heal)
 * - 'failed' + retries left → regenerate Playwright (self-heal)
 * - 'failed' + max retries → report
 */
const routeAfterExecution = (state: AgentState): string => {
  const status = state.executionStatus;

  if (status === "passed" || status === "skipped") {
    return "reportResults";
  }

  // status === "failed" → try self-heal
  // Guard: skip self-heal if Playwright isn't installed (can't run tests anyway)
  if (!isPlaywrightAvailable()) {
    return "reportResults";
  }

  if ((state.retryCount || 0) < 3) {
    return "generatePlaywright";
  }

  // Max retries reached — still report
  return "reportResults";
};

// Build graph — shared nodes
const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("extractRequirements", extractRequirements)
  .addNode("generateCsv", generateCsv)
  .addNode("generatePlaywright", generatePlaywright)
  .addNode("executeTest", executeTest)
  .addNode("reportResults", reportResults)

  // Flow: START → extract → generate CSV → [pause or continue]
  .addEdge(START, "extractRequirements")
  .addEdge("extractRequirements", "generateCsv")
  .addConditionalEdges("generateCsv", routeAfterCsv, {
    generatePlaywright: "generatePlaywright",
    __end__: END,
  })

  // Flow: generate Playwright → execute → [retry or report]
  .addEdge("generatePlaywright", "executeTest")
  .addConditionalEdges("executeTest", routeAfterExecution, {
    generatePlaywright: "generatePlaywright",
    reportResults: "reportResults",
    __end__: END,
  })

  // Flow: report → end
  .addEdge("reportResults", END);

// ── Two compiled graphs ──────────────────────────────────────────

/**
 * Graph for manual/semi modes: pauses at generatePlaywright for CSV review.
 */
export const app = workflow.compile({
  checkpointer,
  interruptBefore: ["generatePlaywright"],
});

/**
 * Graph for autonomous mode: full flow without interrupts.
 * Self-healing uses conditional edges (routeAfterExecution), not interrupt/resume.
 */
export const autoApp = workflow.compile({
  checkpointer,
  interruptBefore: [], // no pauses
});
