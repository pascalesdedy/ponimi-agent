import fs from "fs";
import path from "path";
import { AgentState } from "../state";
import { safeTicketFilename } from "../../security/input";

/**
 * Format execution duration from start/end timestamps.
 */
function formatDuration(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Report test results — enhanced summary with attempt history & timing.
 */
export const reportResults = async (
  state: AgentState
): Promise<Partial<AgentState>> => {
  const ticketId = safeTicketFilename(state.ticketData || "unknown");
  const outputDir = path.resolve(process.cwd(), "output");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ── Status ───────────────────────────────────────────────────────
  const status = state.mode === "manual"
    ? "✅ SCRIPT GENERATED"
    : state.executionStatus === "skipped"
      ? "⏭️ SKIPPED — Playwright not installed"
      : state.executionStatus === "passed"
        ? "✅ PASSED"
        : "❌ FAILED";

  const duration = formatDuration(state.startTime, state.endTime);
  const modeLabel = state.mode || "—";
  const attempts = state.attemptHistory || [];

  // ── Build markdown report ─────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`# QA Test Report: ${ticketId}`);
  lines.push("");
  lines.push(`**Status:** ${status}`);
  lines.push(`**Mode:** ${modeLabel}`);
  lines.push(`**Duration:** ${duration}`);
  lines.push(`**Start:** ${state.startTime || "—"}`);
  lines.push(`**End:** ${state.endTime || "—"}`);
  lines.push(`**Total Attempts:** ${attempts.length}`);
  lines.push("");

  // ── Attempt history table ─────────────────────────────────────────
  if (attempts.length > 0) {
    lines.push("## Execution Attempts");
    lines.push("");
    lines.push("| # | Status | Time | Error |");
    lines.push("|---|--------|------|-------|");
    for (const a of attempts) {
      const time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : "—";
      const statusIcon =
        a.status === "passed" ? "✅ Passed" :
        a.status === "skipped" ? "⏭️ Skipped" :
        "❌ Failed";
      const errorSnippet = a.error
        ? a.error.substring(0, 80).replace(/\n/g, " ")
        : "—";
      lines.push(`| ${a.retryCount} | ${statusIcon} | ${time} | \`${errorSnippet}\` |`);
    }
    lines.push("");
  }

  // ── Error detail ──────────────────────────────────────────────────
  if (state.executionError) {
    lines.push("## Error Details");
    lines.push("");
    lines.push("```");
    lines.push(state.executionError.substring(0, 2000));
    lines.push("```");
    lines.push("");
  }

  // ── Test Case Summary ─────────────────────────────────────────────
  if (state.csvTestCases) {
    const tcCount = state.csvTestCases.split("\n").filter(l => l.trim().startsWith("TC")).length;
    lines.push("## Test Case Summary");
    lines.push("");
    lines.push(`- **Total Test Cases:** ${tcCount}`);
    lines.push(`- **CSV File:** \`output/${ticketId}-testcases.csv\``);
    lines.push("");
  }

  // ── Script info ───────────────────────────────────────────────────
  if (state.playwrightCode) {
    const scriptLen = state.playwrightCode.length;
    lines.push("## Generated Script");
    lines.push("");
    lines.push(`- **File:** \`output/${ticketId}.spec.ts\``);
    lines.push(`- **Size:** ${scriptLen} characters`);
    lines.push("");
    lines.push("### Script Preview");
    lines.push("");
    lines.push("```typescript");
    lines.push(state.playwrightCode.substring(0, 800));
    lines.push("```");
    if (scriptLen > 800) {
      lines.push(`_... (${scriptLen - 800} more characters)_`);
    }
    lines.push("");
  }

  // ── Mode-specific notes ───────────────────────────────────────────
  if (state.mode === "manual") {
    lines.push("## Notes");
    lines.push("");
    lines.push("- **Mode:** Manual — script generated only, no execution.");
    lines.push("- To execute: run with \`--mode semi\` or use the resume flow.");
    lines.push("");
  }

  // ── Write files ───────────────────────────────────────────────────
  // 1. Markdown report
  const reportMd = lines.join("\n");
  const reportMdPath = path.join(outputDir, `${ticketId}-report.md`);
  fs.writeFileSync(reportMdPath, reportMd, "utf-8");

  // 2. Legacy text report (backwards compat)
  const reportTxtPath = path.join(outputDir, `${ticketId}-report.txt`);
  const txtLines = [
    `=== Test Report: ${ticketId} ===`,
    `Status: ${status}`,
    `Mode: ${modeLabel}`,
    `Duration: ${duration}`,
    `Attempts: ${attempts.length}`,
    `Time: ${new Date().toISOString()}`,
    "",
    state.executionError ? `Error: ${state.executionError.substring(0, 500)}` : "All good.",
  ];
  fs.writeFileSync(reportTxtPath, txtLines.join("\n"), "utf-8");

  // 3. CSV file
  if (state.csvTestCases) {
    const csvPath = path.join(outputDir, `${ticketId}-testcases.csv`);
    fs.writeFileSync(csvPath, state.csvTestCases, "utf-8");
  }

  // 4. Playwright script
  if (state.playwrightCode) {
    const scriptPath = path.join(outputDir, `${ticketId}.spec.ts`);
    fs.writeFileSync(scriptPath, state.playwrightCode, "utf-8");
  }

  // TODO: Push to GitHub
  // TODO: Add Jira comment

  // ── Console summary (brief) ───────────────────────────────────────
  const consoleLines: string[] = [];
  consoleLines.push(`📊 ${ticketId} — ${status}`);
  consoleLines.push(`   Mode: ${modeLabel}  |  Duration: ${duration}  |  Attempts: ${attempts.length}`);
  if (state.executionError) {
    consoleLines.push(`   Error: ${state.executionError.substring(0, 120).replace(/\n/g, " ")}`);
  }
  if (state.mode === "manual") {
    consoleLines.push(`   Script: output/${ticketId}.spec.ts`);
  }
  consoleLines.push(`   Report: ${reportMdPath}`);

  return {
    currentStep: consoleLines.join("\n"),
  };
};
