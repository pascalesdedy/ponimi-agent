import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AgentState } from "../state";

/**
 * Execute the generated Playwright script and capture results.
 * Supports self-healing by setting executionError on failure.
 */
export const executeTest = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const code = state.playwrightCode;
  if (!code) {
    return {
      currentStep: "❌ No Playwright code to execute",
      executionError: "playwrightCode is empty",
    };
  }

  const ticketId = state.ticketData || "unknown";
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save the script
  const scriptPath = path.join(outputDir, `${ticketId}.spec.ts`);
  fs.writeFileSync(scriptPath, code, "utf-8");

  const retryCount = (state.retryCount || 0) + 1;

  try {
    // Run the Playwright test
    // In production, this would use Docker sandbox. For now, run directly.
    const result = execSync(
      `npx playwright test "${scriptPath}" --reporter=json 2>&1`,
      {
        cwd: process.cwd(),
        timeout: 120_000, // 2 min timeout
        encoding: "utf-8",
      }
    );

    return {
      executionError: null,
      retryCount,
      currentStep: `✅ Tests passed (attempt ${retryCount})`,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Check if we should retry (self-healing)
    if (retryCount < 3) {
      return {
        executionError: errMsg,
        retryCount,
        currentStep: `🔄 Test failed (attempt ${retryCount}/3). Self-healing...`,
      };
    }

    // Max retries reached
    return {
      executionError: errMsg,
      retryCount,
      currentStep: `❌ Test failed after ${retryCount} attempts. Max retries reached.`,
    };
  }
};
