import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AgentState } from "../state";

/**
 * Execute the generated Playwright script and capture results.
 * Supports self-healing by setting executionError on failure.
 * Auto-detects if Playwright is installed; skips execution if not.
 */
export const executeTest = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const code = state.playwrightCode;
  if (!code) {
    return {
      currentStep: "⏭️ No Playwright code to execute (skipping)",
      executionError: null,
      executionStatus: "skipped",
    };
  }

  const ticketId = state.ticketData || "unknown";
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const scriptPath = path.join(outputDir, `${ticketId}.spec.ts`);
  fs.writeFileSync(scriptPath, code, "utf-8");

  const retryCount = (state.retryCount || 0) + 1;
  const timestamp = new Date().toISOString();

  // Quick check: if playwright not available, skip immediately.
  let playwrightAvailable = false;
  try {
    execSync("npx playwright --version 2>/dev/null", {
      timeout: 5000,
      encoding: "utf-8",
    });
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }

  if (!playwrightAvailable) {
    return {
      executionError: null,
      executionStatus: "skipped",
      selfHealDisabled: true,
      retryCount,
      startTime: state.startTime || timestamp,
      endTime: timestamp,
      attemptHistory: [
        ...(state.attemptHistory || []),
        { retryCount: 0, timestamp, error: null, status: "skipped" },
      ],
      currentStep: `⏭️ Playwright not installed. Script saved to ${scriptPath}. Install with: npx playwright install`,
    };
  }

  // Playwright is available — execute the test
  try {
    execSync(`npx playwright test "${scriptPath}" --reporter=json 2>&1`, {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: "utf-8",
    });

    return {
      executionError: null,
      executionStatus: "passed",
      retryCount,
      startTime: state.startTime || timestamp,
      endTime: timestamp,
      attemptHistory: [
        ...(state.attemptHistory || []),
        { retryCount, timestamp, error: null, status: "passed" },
      ],
      currentStep: `✅ Tests passed (attempt ${retryCount})`,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);

    const canRetry = retryCount < 3;

    if (canRetry) {
      return {
        executionError: errMsg,
        executionStatus: "failed",
        retryCount,
        startTime: state.startTime || timestamp,
        attemptHistory: [
          ...(state.attemptHistory || []),
          { retryCount, timestamp, error: errMsg.substring(0, 500), status: "failed" },
        ],
        currentStep: `🔄 Test failed (attempt ${retryCount}/3). Self-healing...`,
      };
    }

    return {
      executionError: errMsg,
      executionStatus: "failed",
      retryCount,
      startTime: state.startTime || timestamp,
      endTime: timestamp,
      attemptHistory: [
        ...(state.attemptHistory || []),
        { retryCount, timestamp, error: errMsg.substring(0, 500), status: "failed" },
      ],
      currentStep: `❌ Test failed after ${retryCount} attempts. Max retries reached.`,
    };
  }
};
