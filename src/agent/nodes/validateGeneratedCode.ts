import { AgentState } from "../state";
import { validateGeneratedPlaywrightCode } from "../../security/codeSafety";

export const validateGeneratedCode = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const code = state.playwrightCode || "";
  if (!code.trim()) {
    return {
      codeSafe: false,
      executionStatus: "failed",
      selfHealDisabled: true,
      executionError: "Generated script is empty.",
      currentStep: "❌ Blocked execution: generated script is empty.",
    };
  }

  const result = validateGeneratedPlaywrightCode(code);
  if (!result.safe) {
    return {
      codeSafe: false,
      executionStatus: "failed",
      selfHealDisabled: true,
      executionError: `Unsafe generated code blocked: ${result.reasons.join("; ")}`,
      currentStep: "❌ Blocked unsafe generated script before execution.",
    };
  }

  return {
    codeSafe: true,
    currentStep: "✅ Generated script passed safety validation",
  };
};

