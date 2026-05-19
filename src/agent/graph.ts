import { StateGraph, END, START } from "@langchain/langgraph";
import { execSync } from "child_process";
import { AgentStateAnnotation, AgentState } from "./state";
import { extractRequirements } from "./nodes/extractRequirements";
import { generateCsv } from "./nodes/generateCsv";
import { generatePlaywright } from "./nodes/generatePlaywright";
import { executeTest } from "./nodes/executeTest";
import { reportResults } from "./nodes/reportResults";
import { checkpointer } from "../db/sqlite";

/** Cached check: is a test executor available (native Playwright or Docker sandbox)? */
let _executorAvailable: boolean | null = null;
function executorAvailable(): boolean {
  if (_executorAvailable !== null) return _executorAvailable;
  // Check native Playwright
  try {
    execSync("npx playwright --version 2>/dev/null", { timeout: 5000, encoding: "utf-8" });
    _executorAvailable = true;
    return true;
  } catch {
    // fall through
  }
  // Check Docker sandbox
  try {
    const images = execSync("docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null", {
      timeout: 5000, encoding: "utf-8"
    });
    _executorAvailable = images.includes("ponimi-playwright");
    return _executorAvailable;
  } catch {
    _executorAvailable = false;
    return false;
  }
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
 * Route after Playwright generation:
 * - Manual mode: stop (user just wants the script)
 * - Semi / Auto: execute the test
 */
const routeAfterPlaywright = (state: AgentState): string => {
  if (state.mode === "manual") {
    return "reportResults";
  }
  return "executeTest";
};

/**
 * Route after test execution:
 * - 'passed' or 'skipped' → report results
 * - 'failed' + selfHealDisabled → report results (no more retries)
 * - 'failed' + can retry + executor available → regenerate (self-heal)
 * - 'failed' + no executor → report results (skip self-heal)
 */
const routeAfterExecution = (state: AgentState): string => {
  const status = state.executionStatus;

  // Passed/skipped → always report
  if (status === "passed" || status === "skipped") {
    return "reportResults";
  }

  // status === "failed" — check if self-heal allowed
  // Guard 1: explicit selfHealDisabled flag (executor said max retries)
  if (state.selfHealDisabled) {
    return "reportResults";
  }

  // Guard 2: no executor available at all (native or sandbox)
  if (!executorAvailable()) {
    return "reportResults";
  }

  // Guard 3: retry count under max
  if ((state.retryCount || 0) >= 3) {
    return "reportResults";
  }

  // All guards passed → self-heal
  return "generatePlaywright";
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

  // Flow: generate Playwright → [manual: end | semi/auto: execute]
  .addConditionalEdges("generatePlaywright", routeAfterPlaywright, {
    executeTest: "executeTest",
    reportResults: "reportResults",
    __end__: END,
  })

  // Flow: execute → [retry or report]
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
