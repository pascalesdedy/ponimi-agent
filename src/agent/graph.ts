import { StateGraph, END, START } from "@langchain/langgraph";
import { AgentStateAnnotation, AgentState } from "./state";
import { extractRequirements } from "./nodes/extractRequirements";
import { generateCsv } from "./nodes/generateCsv";
import { generatePlaywright } from "./nodes/generatePlaywright";
import { executeTest } from "./nodes/executeTest";
import { reportResults } from "./nodes/reportResults";

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
 * - If passed → report results
 * - If failed + retries left → regenerate Playwright (self-heal)
 * - If failed + max retries → end
 */
const routeAfterExecution = (state: AgentState): string => {
  if (!state.executionError) {
    return "reportResults";
  }

  if ((state.retryCount || 0) < 3) {
    return "generatePlaywright";
  }

  // Max retries reached — still report what happened
  return "reportResults";
};

// Build graph
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

// Compile with interrupt points
export const app = workflow.compile({
  interruptBefore: ["generatePlaywright"], // Pause here for CSV review
});
