import { AgentState } from "../state";
import { callLLM } from "../../llm/provider";

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
 */
export const generateCsv = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const spec = state.instructions || "No specification provided.";

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
    return {
      currentStep: `❌ Failed to generate CSV: ${errMsg}`,
      executionError: errMsg,
    };
  }
};

function countLines(csv: string): number {
  return csv.split("\n").filter((l) => l.trim() && !l.startsWith("ID,")).length;
}
