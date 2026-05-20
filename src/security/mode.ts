export type AgentMode = "manual" | "semi-autonomous" | "autonomous";

export function resolveAgentMode(input: string | undefined, defaultMode: AgentMode = "manual"): AgentMode {
  if (!input) return defaultMode;
  if (input === "auto" || input === "autonomous") return "autonomous";
  if (input === "semi" || input === "semi-autonomous") return "semi-autonomous";
  if (input === "manual") return "manual";
  return defaultMode;
}

