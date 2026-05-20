export interface CodeSafetyResult {
  safe: boolean;
  reasons: string[];
}

const FORBIDDEN_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\bchild_process\b/, reason: "Forbidden Node module: child_process" },
  { regex: /\bexecSync?\s*\(/, reason: "Forbidden process execution call" },
  { regex: /\bspawn\s*\(/, reason: "Forbidden process spawn call" },
  { regex: /\brequire\s*\(\s*['"]fs['"]\s*\)/, reason: "Forbidden fs module import via require" },
  { regex: /\bimport\s+.*\bfrom\s+['"]fs['"]/, reason: "Forbidden fs module import" },
  { regex: /\bprocess\.env\b/, reason: "Forbidden environment access" },
  { regex: /\bfetch\s*\(\s*['"]http:\/\/(localhost|127\.0\.0\.1)/i, reason: "Forbidden localhost network access" },
];

export function validateGeneratedPlaywrightCode(code: string): CodeSafetyResult {
  const reasons: string[] = [];
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.regex.test(code)) {
      reasons.push(rule.reason);
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}

