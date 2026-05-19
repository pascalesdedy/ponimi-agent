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
        const reportStep = currentState.values.currentStep as string | undefined;

        // Show console summary from reportResults (if available)
        if (reportStep && reportStep.includes("📊")) {
          console.log(`\n${reportStep}`);
        } else {
          if (csv) {
            console.log(`\n${pc.cyan("📋 Generated Test Cases:")}`);
            const preview = csv.substring(0, 600);
            console.log(preview);
            if (csv.length > 600) console.log(pc.dim(`... (${csv.length - 600} more chars)`));
          }

          if (pw) {
            console.log(`\n${pc.cyan("💻 Generated Script:")}`);
            const preview = pw.substring(0, 400);
            console.log(preview);
            if (pw.length > 400) console.log(pc.dim(`... (${pw.length - 400} more chars)`));
          }

          if (err) {
            console.log(`\n${pc.red("❌ Error:")} ${err.substring(0, 200)}`);
          }
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
      const config = {
        configurable: { thread_id: threadId },
      };

      // Resume via LangGraph checkpointer (SQLite — works across restarts)
      const stream = await app.stream(null, config);

      for await (const step of stream) {
        const nodeName = Object.keys(step)[0];
        const nodeState = step[nodeName];

        if (nodeState?.currentStep) {
          s.message(String(nodeState.currentStep));
        }
      }

      s.stop("✅ Execution resumed and complete");

      // Show console summary from resume
      const currentState = await app.getState(config);
      if (currentState?.values?.currentStep) {
        const step = String(currentState.values.currentStep);
        if (step.includes("📊")) {
          console.log(`\n${step}`);
        }
      }

      outro("All steps complete!");
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
