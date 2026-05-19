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

  // Save summary report
  const summary = [
    `=== Test Report: ${ticketId} ===`,
    `Status: ${passed ? "✅ PASSED" : "❌ FAILED"}`,
    `Attempts: ${state.retryCount || 1}`,
    `Time: ${new Date().toISOString()}`,
    "",
    passed ? "All tests executed successfully." : `Error: ${state.executionError}`,
    "",
    "--- Script Output ---",
    state.playwrightCode?.substring(0, 500) || "No script generated.",
  ].join("\n");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const reportPath = path.join(outputDir, `${ticketId}-report.txt`);
  fs.writeFileSync(reportPath, summary, "utf-8");

  // TODO: Push to GitHub
  // TODO: Add Jira comment

  return {
    currentStep: passed
      ? `✅ ${ticketId}: All tests passed. Report: ${reportPath}`
      : `❌ ${ticketId}: Tests failed. Report: ${reportPath}`,
  };
};
