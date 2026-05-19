#!/usr/bin/env node

import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import { app, autoApp } from "./agent/graph";
import { env } from "./config/env";
import pc from "picocolors";
import fs from "fs";
import path from "path";

const program = new Command();

program
  .name("ponimi")
  .description("🦄 Ponimi — Autonomous QA Agent")
  .version("1.0.0");

// ─── run ─────────────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Run agent for a ticket/project")
  .option("-t, --ticket <id>", "Ticket ID (e.g. QA-123)")
  .option(
    "-m, --mode <mode>",
    "Operation mode: manual | semi | auto",
    "manual"
  )
  .action(async (options) => {
    intro(`${pc.cyan("🦄 Ponimi QA Agent")}`);

    const ticket = options.ticket || `TICKET-${Date.now()}`;
    let mode: "manual" | "semi-autonomous" | "autonomous" = "manual";
    if (options.mode === "auto") mode = "autonomous";
    else if (options.mode === "semi") mode = "semi-autonomous";

    if (!env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY) {
      console.log(pc.yellow("⚠️  No API key configured. Running in mock mode.\n"));
    }

    const threadId = `thread-${ticket}`;
    const config = {
      configurable: { thread_id: threadId },
    };

    const s = spinner();
    s.start("Initializing...");

    const initialState = {
      ticketData: ticket,
      mode,
      retryCount: 0,
      currentStep: "🚀 Starting...",
      instructions: "",
      csvTestCases: "",
      playwrightCode: "",
      executionError: null as string | null,
      executionStatus: "not_run",
      selfHealDisabled: false,
    };

    try {
      // Auto mode: use autoApp (no interrupt), single stream
      // Manual/semi mode: use app (with interrupt), single stream + loop for resume
      const activeApp = mode === "autonomous" ? autoApp : app;
      const maxIterations = mode === "autonomous" ? 1 : 3;

      let hasMore = true;
      let iteration = 0;

      while (hasMore && iteration < maxIterations) {
        const stream = await activeApp.stream(iteration === 0 ? initialState : null, config);

        for await (const step of stream) {
          const nodeName = Object.keys(step)[0];
          const nodeState = step[nodeName];

          if (nodeState?.currentStep) {
            s.message(String(nodeState.currentStep));
          }
        }

        const currentState = await activeApp.getState(config);
        hasMore = (currentState?.next?.length ?? 0) > 0;
        iteration++;
      }

      s.stop("✅ Graph execution complete");

      // Show results
      const currentState = await activeApp.getState(config);

      if (currentState) {
        const csv = currentState.values.csvTestCases as string | undefined;
        const pw = currentState.values.playwrightCode as string | undefined;
        const err = currentState.values.executionError as string | null;

        // Save snapshot for cross-process resume
        const dataDir = path.resolve(process.cwd(), "data");
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (csv) {
          const snapPath = path.join(dataDir, `${threadId}.json`);
          fs.writeFileSync(snapPath, JSON.stringify({
            ticketData: ticket,
            csvTestCases: csv,
            mode,
            retryCount: currentState.values.retryCount || 0,
          }, null, 2), "utf-8");
        }

        if (csv) {
          console.log(`\n${pc.cyan("📋 Generated Test Cases:")}`);
          console.log(csv.substring(0, 800));
          if (csv.length > 800) console.log(pc.dim(`... (${csv.length - 800} more chars)`));
        }

        if (pw) {
          console.log(`\n${pc.cyan("💻 Generated Script:")}`);
          console.log(pw.substring(0, 500));
          if (pw.length > 500) console.log(pc.dim(`... (${pw.length - 500} more chars)`));
        }

        if (err) {
          console.log(`\n${pc.red("❌ Error:")} ${err.substring(0, 300)}`);
        }
      }

      const modeLabel = mode === "semi-autonomous" ? "Semi-Autonomous" : "Manual";
      if (mode === "autonomous") {
        outro("✅ Autonomous run complete!");
      } else {
        outro(
          `${modeLabel} mode — CSV generated.\n` +
          `  📄 ${pc.dim("Review CSV:     ")} ${pc.cyan("cat output/" + ticket + "-testcases.csv")}\n` +
          `  ▶ ${pc.dim("Approve/resume: ")} ${pc.green("ponimi resume -t " + threadId)}`
        );
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      s.stop(pc.red(`❌ Error: ${errMsg}`));
      outro(pc.red("Run failed."));
      process.exit(1);
    }
  });

// ─── resume ──────────────────────────────────────────────────────────────────
program
  .command("resume")
  .description("Resume interrupted graph (continue to Playwright generation + execution)")
  .option("-t, --thread <id>", "Thread ID (e.g. thread-QA-LOGIN-001)")
  .option("-m, --mode <mode>", "Override mode: manual | semi", "manual")
  .action(async (options) => {
    const threadId = options.thread || `thread-TICKET-${Date.now()}`;
    let mode: "manual" | "semi-autonomous" | "autonomous" = "manual";
    if (options.mode === "semi") mode = "semi-autonomous";

    // Extract ticket from thread ID
    const ticket = threadId.replace("thread-", "");

    const s = spinner();
    s.start("Resuming execution...");

    try {
      // Try LangGraph resume first (works within same process)
      const config = {
        configurable: { thread_id: threadId },
      };

      try {
        const stream = await app.stream(null, config);

        for await (const step of stream) {
          const nodeName = Object.keys(step)[0];
          const nodeState = step[nodeName];

          if (nodeState?.currentStep) {
            s.message(String(nodeState.currentStep));
          }
        }

        s.stop("✅ Execution resumed and complete");
        outro("All steps complete!");
        return;
      } catch (_resumeErr) {
        // Checkpointer not available (new process) — fallback to snapshot method
        s.message("Checkpointer unavailable, using snapshot resume...");
      }

      // ── Snapshot resume (cross-process) ────────────────────────────
      const snapPath = path.resolve(process.cwd(), "data", `${threadId}.json`);
      const modeLabel = mode === "semi-autonomous" ? "semi-autonomous" : "manual";

      s.message("Generating Playwright script from saved CSV...");

      // Read CSV from snapshot or output
      let savedCsv = "";
      const outputCsvPath = path.resolve(process.cwd(), "output", `${ticket}-testcases.csv`);
      if (fs.existsSync(snapPath)) {
        const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
        savedCsv = snap.csvTestCases || "";
      }
      if (!savedCsv && fs.existsSync(outputCsvPath)) {
        savedCsv = fs.readFileSync(outputCsvPath, "utf-8");
      }

      if (!savedCsv) {
        throw new Error(`No saved CSV found for ${ticket}. Run 'ponimi run -t ${ticket} -m manual' first.`);
      }

      // Load instructions
      let instructions = "";
      const instructionsDir = path.resolve(process.cwd(), "instructions");
      const instructionsPath = path.join(instructionsDir, "automation", "playwright.md");
      if (fs.existsSync(instructionsPath)) {
        instructions = fs.readFileSync(instructionsPath, "utf-8");
      }

      // Run generatePlaywright node directly
      const { generatePlaywright } = await import("./agent/nodes/generatePlaywright");
      const pwState = await generatePlaywright({
        ticketData: ticket,
        csvTestCases: savedCsv,
        playwrightCode: "",
        instructions,
        mode,
        retryCount: 0,
        currentStep: "",
        executionError: null,
        executionStatus: "not_run",
        selfHealDisabled: false,
      });

      if (pwState.currentStep) {
        s.message(String(pwState.currentStep));
      }

      const playwrightCode = pwState.playwrightCode || "";

      // Save the script
      const scriptDir = path.resolve(process.cwd(), "output");
      if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
      const scriptPath = path.join(scriptDir, `${ticket}.spec.ts`);
      fs.writeFileSync(scriptPath, playwrightCode, "utf-8");

      // Manual mode: stop after script generation
      if (mode === "manual") {
        s.stop(`✅ Script generated: ${pc.cyan(scriptPath)}`);
        console.log(`\n${pc.cyan("💻 Generated Script:")}`);
        console.log(playwrightCode.substring(0, 500));
        if (playwrightCode.length > 500) console.log(pc.dim(`... (${playwrightCode.length - 500} more chars)`));
        outro("Manual mode complete!");
        return;
      }

      // Semi mode: execute the test
      s.message("Executing Playwright tests...");
      const { executeTest } = await import("./agent/nodes/executeTest");
      const execState = await executeTest({
        ticketData: ticket,
        csvTestCases: savedCsv,
        playwrightCode,
        instructions,
        mode,
        retryCount: 1,
        executionError: null,
        executionStatus: "script_generated",
        selfHealDisabled: false,
        currentStep: "",
      } as any); // Skip full AgentState for manual node call

      if (execState.currentStep) {
        s.message(String(execState.currentStep));
      }

      s.stop(
        execState.executionStatus === "passed"
          ? "✅ All tests passed!"
          : execState.executionStatus === "skipped"
            ? "⏭️ Execution skipped (no Playwright installed)"
            : "❌ Tests failed. Check output/" + ticket + "-report.txt"
      );
      outro("Resume complete!");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      s.stop(pc.red(`❌ Error: ${errMsg}`));
      process.exit(1);
    }
  });

// ─── worker ──────────────────────────────────────────────────────────────────
program
  .command("worker")
  .description("Start background worker for autonomous mode")
  .action(async () => {
    console.log(pc.cyan("👷 Ponimi Worker — listening for jobs..."));
    console.log(pc.dim("(BullMQ worker — requires Redis running)"));
    console.log(pc.dim("Press Ctrl+C to stop.\n"));
    console.log("Worker mode: coming in Phase 5!");
    console.log("For now, use: ponimi run --ticket <id> --mode auto");
  });

program.parse(process.argv);
