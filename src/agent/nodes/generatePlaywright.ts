import fs from "fs";
import path from "path";
import { AgentState } from "../state";
import { callLLM } from "../../llm/provider";
import { env } from "../../config/env";

const SYSTEM_PROMPT = `You are a senior QA automation engineer specializing in Playwright (TypeScript).

Given CSV test cases and custom instructions, generate a complete, production-ready Playwright test script.

Requirements:
- Use Playwright's native test runner syntax (test.describe, test, expect)
- Use proper locators (getByRole, getByTestId, getByText, getByLabel)
- Include proper assertions
- Handle async operations (waitFor, toBeVisible, etc.)
- Use Page Object Model pattern when appropriate
- Add proper error handling and timeouts
- Include beforeEach/afterEach for setup/teardown

Output ONLY the raw TypeScript code. No markdown fences, no explanations.`;

/**
 * Generate Playwright test script from CSV test cases and instructions.
 * Falls back to mock script if LLM is unavailable.
 * Includes previous error context for self-healing retries.
 */
export const generatePlaywright = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const csv = state.csvTestCases || "No test cases provided.";
  const previousError = state.executionError;
  const retryCount = state.retryCount || 0;

  // Load custom automation instructions
  let customInstructions = "";
  const autoDir = path.resolve(process.cwd(), "instructions/automation");
  if (fs.existsSync(autoDir)) {
    const files = fs
      .readdirSync(autoDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const file of files) {
      customInstructions += `\n<!-- ${file} -->\n${fs.readFileSync(
        path.join(autoDir, file),
        "utf-8"
      )}\n`;
    }
  }

  // Use mock if env says so or no API key
  const noApiKey = !env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY;
  if (env.LLM_MOCK || noApiKey) {
    const playwrightCode = generateMockScript(state.ticketData || "TICKET", csv);
    const outputPath = saveScript(state, playwrightCode);
    return {
      playwrightCode,
      executionStatus: "script_generated",
      currentStep: `✅ Playwright script saved (mock): ${outputPath}`,
    };
  }

  try {
    const playwrightCode = await callLLM(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Generate Playwright test script for ticket ${state.ticketData || "UNKNOWN"}.`,
            "",
            "## CSV Test Cases",
            csv,
            customInstructions ? `\n## Custom Automation Rules\n${customInstructions}` : "",
            previousError ? `\n## Previous Error (Retry #${retryCount})\nThe previous attempt failed with:\n\`\`\`\n${previousError.substring(0, 2000)}\n\`\`\`\n\nFix the script to avoid this error.` : "",
            "",
            "Generate a single complete Playwright test file covering ALL test cases.",
          ].filter(Boolean).join("\n"),
        },
      ],
      { temperature: 0.2 }
    );

    const outputPath = saveScript(state, playwrightCode);
    return {
      playwrightCode,
      executionStatus: "script_generated",
      currentStep: `✅ Playwright script saved: ${outputPath}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Fallback to mock
    const playwrightCode = generateMockScript(state.ticketData || "TICKET", csv);
    const outputPath = saveScript(state, playwrightCode);
    return {
      playwrightCode,
      executionStatus: "script_generated",
      currentStep: `⚠️ LLM call failed (${errMsg}). Using mock script.`,
      executionError: errMsg,
    };
  }
};

function generateMockScript(ticketId: string, csv: string): string {
  const module = ticketId.includes("LOGIN") ? "Login" : ticketId.includes("PAY") ? "Payment" : "Main";
  return `import { test, expect } from '@playwright/test';

test.describe('${module} Module - ${ticketId}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // TC-001: Successfully login with valid credentials
  test('TC-001 - Successfully login with valid credentials', async ({ page }) => {
    // P0: Positive - Happy path
    await page.getByLabel('Username').fill('valid_user');
    await page.getByLabel('Password').fill('valid_pass');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  // TC-002: Login with invalid password
  test('TC-002 - Login with invalid password', async ({ page }) => {
    // P0: Negative - Error handling
    await page.getByLabel('Username').fill('valid_user');
    await page.getByLabel('Password').fill('wrong_password');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  // TC-003: Login with empty fields
  test('TC-003 - Login with empty fields', async ({ page }) => {
    // P1: Negative - Validation
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });
});
`;
}

function saveScript(state: AgentState, code: string): string {
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ticketId = state.ticketData || "unknown";
  const outputPath = path.join(outputDir, `${ticketId}.spec.ts`);
  fs.writeFileSync(outputPath, code, "utf-8");
  return outputPath;
}
