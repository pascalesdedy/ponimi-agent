import fs from "fs";
import path from "path";
import { AgentState } from "../state";

/**
 * Extract requirements from the ticket ID and local instruction files.
 * Falls back to a generated specification if no Jira integration is configured.
 */
export const extractRequirements = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const ticketId = state.ticketData || "UNKNOWN-TICKET";
  const targetUrl = state.targetUrl || "";
  const description = state.description || "";

  // 1. Try to load custom instructions from instructions/ directory
  let customInstructions = "";
  const testcasesDir = path.resolve(process.cwd(), "instructions/testcases");

  if (fs.existsSync(testcasesDir)) {
    const files = fs
      .readdirSync(testcasesDir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(testcasesDir, file), "utf-8");
      customInstructions += `\n<!-- From ${file} -->\n${content}\n`;
    }
  }

  // 2. Generate base requirements from ticket ID
  // In production, this would fetch from Jira API
  const specText = `
## Test Specification: ${ticketId}

### Overview
${description ? `User request: ${description}\n\n` : ""}Automated test suite for ticket ${ticketId}. 
Generate comprehensive test cases covering:
- Positive scenarios (happy path)
- Negative scenarios (error handling, edge cases)
- Boundary conditions
- UI validation where applicable

### Target Environment
${targetUrl ? `Base URL: ${targetUrl}\n- All tests should navigate relative to this URL\n- Use this URL for the application under test` : "No specific URL provided. Use example.com as placeholder."}

### Requirements
- All test cases must be executable via Playwright
- Include assertions for expected outcomes
- Cover both functional and UI validation
- Use data-testid selectors when possible
- Handle loading states and async operations

${customInstructions ? `### Custom Instructions\n${customInstructions}` : ""}
`;

  return {
    ticketData: ticketId,
    instructions: specText,
    currentStep: `📋 Extracted requirements for ${ticketId}`,
  };
};
