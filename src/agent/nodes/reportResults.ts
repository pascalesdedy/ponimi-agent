import fs from "fs";
import path from "path";
import { AgentState } from "../state";

/**
 * Report test results — save summary, optionally push to GitHub / Jira.
 */
export const reportResults = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const ticketId = state.ticketData || "unknown";
  const passed = !state.executionError;
  const outputDir = path.resolve(process.cwd(), "output");

  const summaryLines = [
    `=== Test Report: ${ticketId} ===`,
    `Status: ${passed ? "✅ PASSED" : "❌ FAILED"}`,
    `Attempts: ${state.retryCount || 1}`,
    `Time: ${new Date().toISOString()}`,
    "",
    passed ? "All tests executed successfully." : `Error: ${state.executionError}`,
  ];

  // Manual mode: just script generation, no execution
  if (state.mode === "manual") {
    summaryLines.push(`Mode: Manual (script only, no execution)`);
  }

  summaryLines.push(
    "",
    "--- Generated Playwright Script ---",
    state.playwrightCode?.substring(0, 500) || "No script generated.",
  );

  // Include CSV for review
  if (state.csvTestCases) {
    summaryLines.push(
      "",
      "--- Test Cases (CSV) ---",
      state.csvTestCases.substring(0, 300),
    );
  }

  const summary = summaryLines.join("\n");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const reportPath = path.join(outputDir, `${ticketId}-report.txt`);
  fs.writeFileSync(reportPath, summary, "utf-8");

  // Save CSV to separate file for manual review
  if (state.csvTestCases) {
    const csvPath = path.join(outputDir, `${ticketId}-testcases.csv`);
    fs.writeFileSync(csvPath, state.csvTestCases, "utf-8");
  }

  // Save Playwright script
  if (state.playwrightCode) {
    const scriptPath = path.join(outputDir, `${ticketId}.spec.ts`);
    fs.writeFileSync(scriptPath, state.playwrightCode, "utf-8");
  }

  // TODO: Push to GitHub
  // TODO: Add Jira comment

  const modeLabel = state.mode === "manual" ? "script" : "tests";
  return {
    currentStep: passed
      ? `✅ ${ticketId}: All ${modeLabel} generated.`
      : `❌ ${ticketId}: ${modeLabel} failed. Report: ${reportPath}`,
  };
};
