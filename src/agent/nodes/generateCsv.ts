import { AgentState } from "../state";
import { callLLM } from "../../llm/provider";
import { env } from "../../config/env";

const SYSTEM_PROMPT = `You are a senior QA engineer. Given a test specification, generate comprehensive test cases in CSV format.

Output ONLY valid CSV with these columns:
ID,Module,Feature,TestScenario,TestSteps,ExpectedResult,Priority,Type,Automated

Rules:
- Priority: P0 (critical) / P1 (high) / P2 (medium) / P3 (low)
- Type: Positive / Negative / Boundary / UI / Security
- Automated: Yes / No
- Steps should be clear, numbered actions
- Expected results must be specific and verifiable
- Cover happy path, error cases, edge cases, and UI validation
- Minimum 5 test cases, maximum 20

Do NOT include markdown formatting or code fences. Output raw CSV only.`;

/**
 * Generate CSV test cases from requirements using LLM.
 * Falls back to mock data if LLM is unavailable or LLM_MOCK=true.
 */
export const generateCsv = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const spec = state.instructions || "No specification provided.";

  // Use mock data if env says so or no API key configured
  const noApiKey = !env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY;
  if (env.LLM_MOCK || noApiKey) {
    const csvContent = generateMockCsv(state.ticketData || "TICKET");
    return {
      csvTestCases: csvContent,
      currentStep: `✅ Generated ${countLines(csvContent)} test cases (mock)`,
    };
  }

  try {
    const csvContent = await callLLM([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Generate test cases for this specification:\n\n${spec}`,
      },
    ]);

    return {
      csvTestCases: csvContent,
      currentStep: `✅ Generated ${countLines(csvContent)} test cases`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // Fallback to mock on API error
    const csvContent = generateMockCsv(state.ticketData || "TICKET");
    return {
      csvTestCases: csvContent,
      currentStep: `⚠️ LLM call failed (${errMsg}). Using mock data.`,
      executionError: errMsg,
    };
  }
};

function generateMockCsv(ticketId: string): string {
  const module = ticketId.includes("LOGIN") ? "Auth" : ticketId.includes("PAY") ? "Payment" : "General";
  return [
    "ID,Module,Feature,TestScenario,TestSteps,ExpectedResult,Priority,Type,Automated",
    `TC-001,${module},User Login,Successfully login with valid credentials,"1. Open app\n2. Input valid username\n3. Input valid password\n4. Click Login","User redirected to dashboard",P0,Positive,Yes`,
    `TC-002,${module},User Login,Login with invalid password,"1. Open app\n2. Input valid username\n3. Input invalid password\n4. Click Login","Error message displayed: Invalid credentials",P0,Negative,Yes`,
    `TC-003,${module},User Login,Login with empty fields,"1. Open app\n2. Leave username empty\n3. Leave password empty\n4. Click Login","Validation errors shown for both fields",P1,Negative,Yes`,
    `TC-004,${module},User Login,Password field masks input,"1. Open app\n2. Input password","Password characters are masked (●●●●)",P2,UI,Yes`,
    `TC-005,${module},User Login,Login button state while loading,"1. Open app\n2. Input credentials\n3. Click Login","Login button shows loading state + disabled",P2,UI,Yes`,
  ].join("\n");
}

function countLines(csv: string): number {
  return csv.split("\n").filter((l) => l.trim() && !l.startsWith("ID,")).length;
}
