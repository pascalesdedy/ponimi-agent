import fs from "fs";
import path from "path";
import { AgentState } from "../state";
import { callLLM } from "../../llm/provider";

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
- Use data-testid selectors when mentioned in the spec

Output ONLY the raw TypeScript code. No markdown fences, no explanations.`;

/**
 * Generate Playwright test script from CSV test cases and instructions.
 */
export const generatePlaywright = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const csv = state.csvTestCases || "No test cases provided.";
  const instructions = state.instructions || "";

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

  try {
    const playwrightCode = await callLLM(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Generate Playwright test script for these test cases:

## CSV Test Cases
${csv}

## Specification Context
${instructions}

${customInstructions ? `## Custom Automation Rules\n${customInstructions}` : ""}

Generate a single complete Playwright test file covering ALL test cases from the CSV.`,
        },
      ],
      { temperature: 0.2 }
    );

    // Save to output directory
    const outputDir = path.resolve(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ticketId = state.ticketData || "unknown";
    const outputPath = path.join(outputDir, `${ticketId}.spec.ts`);
    fs.writeFileSync(outputPath, playwrightCode, "utf-8");

    return {
      playwrightCode,
      currentStep: `✅ Playwright script saved: ${outputPath}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      currentStep: `❌ Failed to generate Playwright script: ${errMsg}`,
      executionError: errMsg,
    };
  }
};
