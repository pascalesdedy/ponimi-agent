import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AgentState } from "../state";
import {
  runInSandbox,
  getBestExecutor,
} from "../../sandbox/docker";

/** Maximum self-healing attempts */
const MAX_RETRIES = 3;

/**
 * Parse error from test execution into structured parts.
 * Used by self-healing logic to understand what went wrong.
 */
function parseTestError(errMsg: string): {
  category: string;
  rootCause: string;
  selector?: string;
  element?: string;
  line?: number;
} {
  const result = {
    category: "unknown",
    rootCause: errMsg.substring(0, 200),
  } as any;

  // Common Playwright error patterns
  if (errMsg.includes("locator") && errMsg.includes("not found")) {
    result.category = "locator_not_found";
    const match = errMsg.match(/locator[^:]*:\s*([^\n]+)/);
    if (match) result.selector = match[1].trim();
  } else if (errMsg.includes("Timeout") || errMsg.includes("timeout")) {
    result.category = "timeout";
    const match = errMsg.match(/locator[^:]*:\s*([^\n]+)/);
    if (match) result.selector = match[1].trim();
  } else if (errMsg.includes("Target closed")) {
    result.category = "target_closed";
  } else if (errMsg.includes("net::ERR_")) {
    result.category = "network_error";
    const match = errMsg.match(/(net::ERR_\w+)/);
    if (match) result.rootCause = match[1];
  } else if (errMsg.includes("navigation") && errMsg.includes("failed")) {
    result.category = "navigation_failed";
  } else if (errMsg.includes("page.goto")) {
    result.category = "goto_failed";
  } else if (errMsg.includes("syntax") || errMsg.includes("SyntaxError")) {
    result.category = "syntax_error";
  } else if (errMsg.includes("TypeError")) {
    result.category = "type_error";
  } else if (errMsg.includes("Not running") || errMsg.includes("browserType.launch")) {
    result.category = "browser_launch";
  }

  // Extract line number
  const lineMatch = errMsg.match(/(?:line\s+)(\d+)/i) || errMsg.match(/\.spec\.ts[:(](\d+)/);
  if (lineMatch) result.line = parseInt(lineMatch[1], 10);

  return result;
}

/**
 * Generate a self-healing hint based on parsed error.
 * These hints are passed to the LLM when regenerating the script.
 */
function generateHealingHint(parsed: ReturnType<typeof parseTestError>): string {
  switch (parsed.category) {
    case "locator_not_found":
      return `Self-healing: Selector not found. Try alternative locator strategy. ${
        parsed.selector
          ? `Previous selector: "${parsed.selector}". Use a more robust selector (text, data-testid, role, or nth-match).`
          : "Use more robust selectors (text, data-testid, role, or nth-match)."
      } Add waitForSelector before interaction.`;
    case "timeout":
      return `Self-healing: Element timed out. ${
        parsed.selector
          ? `Selector: "${parsed.selector}". `
          : ""
      }Increase timeout or add waitForLoadState/page.waitForSelector before the action. Check if page navigation completed.`;
    case "target_closed":
      return "Self-healing: Page/target closed unexpectedly. Check for popups, new tabs, or unexpected page transitions. Add waits for new pages (context.waitForEvent('page')).";
    case "network_error":
      return `Self-healing: Network error — ${parsed.rootCause}. Check page URL, add route interception if blocking resources.`;
    case "navigation_failed":
      return "Self-healing: Navigation failed. Add waitForLoadState before interacting. Check URL format.";
    case "goto_failed":
      return "Self-healing: page.goto failed. Verify BASE_URL is correct and accessible. Add error handling for navigation.";
    case "syntax_error":
      return `Self-healing: TypeScript syntax error. Fix syntax issues in generated code. Ensure all parentheses, brackets, and async/await are correct.`;
    case "type_error":
      return "Self-healing: TypeError in script. Check variable types, ensure all Playwright imports are correct.";
    case "browser_launch":
      return "Self-healing: Browser launch error. Ensure correct Chromium path or use channel: 'chromium'. In Docker, use chromium path directly.";
    default:
      return `Self-healing: ${parsed.rootCause.substring(0, 100)}. Check test script for issues.`;
  }
}

/**
 * Execute the generated Playwright script.
 *
 * Detection priority:
 *   1. Docker sandbox (if image built)
 *   2. Native Playwright (if installed)
 *   3. Skip (no executor available)
 *
 * Self-healing: parses error, generates hint, returns state for regeneration.
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

  // ── Detect best executor ──────────────────────────────────────────
  const executor = getBestExecutor();

  if (executor === "none") {
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
      currentStep: `⏭️ No Playwright executor available. Script saved to ${scriptPath}.\n  Options: install Playwright natively or build Docker sandbox:\n  docker build -f docker/Dockerfile.playwright -t ponimi-playwright:latest .`,
    };
  }

  const attemptLabel = executor === "sandbox" ? "🐳 Docker sandbox" : "💻 Native Playwright";

  // ── Execute ───────────────────────────────────────────────────────
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let errorMsg: string | null = null;

  try {
    if (executor === "sandbox") {
      const result = await runInSandbox(scriptPath, outputDir, 120_000);
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
      errorMsg = result.timedOut ? `⏱️ Test timed out (120s)` : result.success ? null : (stderr || "Test failed");
    } else {
      // Native Playwright
      try {
        stdout = execSync(
          `npx playwright test "${scriptPath}" --reporter=json 2>&1`,
          { cwd: process.cwd(), timeout: 120_000, encoding: "utf-8" }
        );
        exitCode = 0;
        errorMsg = null;
      } catch (execErr: unknown) {
        const err = execErr as Error & { stdout?: string; stderr?: string; status?: number };
        stdout = err.stdout || "";
        stderr = err.stderr || "";
        exitCode = err.status ?? 1;
        errorMsg = err.message;
      }
    }
  } catch (error: unknown) {
    errorMsg = error instanceof Error ? error.message : String(error);
  }

  // ── Check if passed ──────────────────────────────────────────────
  const passed = errorMsg === null && exitCode === 0;

  if (passed) {
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
      currentStep: `✅ Tests passed via ${attemptLabel} (attempt ${retryCount})`,
      selfHealDisabled: true, // signal to graph: don't retry
    };
  }

  // ── Parse error for self-healing ──────────────────────────────────
  const fullError = errorMsg || stderr || "Unknown error";
  const parsed = parseTestError(fullError);
  const healingHint = generateHealingHint(parsed);

  const canRetry = retryCount < MAX_RETRIES;

  const attemptEntry = {
    retryCount,
    timestamp,
    error: fullError.substring(0, 500),
    status: "failed",
  };

  if (canRetry) {
    // Return with healing hint — graph conditional edge will route to regenerate
    return {
      executionError: fullError,
      executionStatus: "failed",
      retryCount,
      startTime: state.startTime || timestamp,
      attemptHistory: [...(state.attemptHistory || []), attemptEntry],
      currentStep: `🔄 Test failed via ${attemptLabel} (attempt ${retryCount}/${MAX_RETRIES}). ${healingHint}`,
      // Store healing context for the regenerate step
      instructions: healingHint,
      selfHealDisabled: false, // can still try
    };
  }

  // ── Max retries reached — signal graph to stop ────────────────────
  return {
    executionError: fullError,
    executionStatus: "failed",
    retryCount,
    startTime: state.startTime || timestamp,
    endTime: timestamp,
    attemptHistory: [...(state.attemptHistory || []), attemptEntry],
    currentStep: `❌ Test failed via ${attemptLabel} after ${retryCount} attempts. Max retries reached.\n  ${healingHint}`,
    selfHealDisabled: true, // signal to graph: stop retrying
  };
};
