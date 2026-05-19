import { Worker, Job } from "bullmq";
import { env } from "../config/env";
import { autoApp, app } from "../agent/graph";
import fs from "fs";
import path from "path";

const REDIS_URL = env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ponimi-jobs";

// ── Types ──────────────────────────────────────────────────────────────────

interface QueuedJob {
  ticketId: string;
  mode: "manual" | "semi-autonomous" | "autonomous";
  targetUrl?: string;
  description?: string;
  submittedAt: string;
}

/**
 * Run the full LangGraph pipeline for a given job.
 * Wrapped in try/catch so BullMQ always gets a resolve or reject.
 */
async function processRun(job: Job<QueuedJob>): Promise<Record<string, unknown>> {
  const { ticketId, mode, targetUrl, description } = job.data;
  const threadId = `thread-${ticketId}`;
  const config = { configurable: { thread_id: threadId } };

  // Ensure output directory exists
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const initialState = {
    ticketData: ticketId,
    targetUrl: targetUrl || "",
    description: description || "",
    mode,
    retryCount: 0,
    currentStep: "🚀 Worker: Starting...",
    instructions: "",
    csvTestCases: "",
    playwrightCode: "",
    executionError: null as string | null,
    executionStatus: "not_run",
    selfHealDisabled: false,
    startTime: null as string | null,
    endTime: null as string | null,
    attemptHistory: [] as Array<{
      retryCount: number;
      timestamp: string;
      error: string | null;
      status: string;
    }>,
  };

  await job.updateProgress(10);

  const activeApp = mode === "autonomous" ? autoApp : app;

  // Extend lock while running (BullMQ will auto-extend if we keep yielding)
  let stream;
  try {
    stream = await activeApp.stream(initialState, config);
  } catch (streamErr) {
    const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
    throw new Error(`Graph stream failed to start: ${msg}`);
  }

  for await (const step of stream) {
    const nodeName = Object.keys(step)[0];
    const nodeState = step[nodeName] as Record<string, unknown> | undefined;

    if (nodeState?.currentStep) {
      await job.log(String(nodeState.currentStep));

      // Map progress by node type
      const stepStr = String(nodeState.currentStep);
      if (stepStr.includes("Extracted")) {
        await job.updateProgress(30);
      } else if (stepStr.includes("CSV") || stepStr.includes("Generated")) {
        await job.updateProgress(50);
      } else if (stepStr.includes("Playwright")) {
        await job.updateProgress(70);
      } else if (
        stepStr.includes("Test") ||
        stepStr.includes("Execution") ||
        stepStr.includes("Executing")
      ) {
        await job.updateProgress(85);
      }
    }
  }

  // Read final state
  let finalState;
  try {
    finalState = await activeApp.getState(config);
  } catch {
    // State may be gone if graph already ended — that's okay
    finalState = null;
  }

  const values = (finalState?.values || {}) as Record<string, unknown>;

  const reportPath = path.join(outputDir, `${ticketId}-report.md`);
  const reportExists = fs.existsSync(reportPath);

  const result: Record<string, unknown> = {
    ticketId,
    status: values.executionStatus || "completed",
    mode,
    duration:
      values.startTime && values.endTime
        ? formatDuration(values.startTime as string, values.endTime as string)
        : "unknown",
    reportFile: reportExists ? reportPath : null,
    csvFile: path.join(outputDir, `${ticketId}-testcases.csv`),
    scriptFile: path.join(outputDir, `${ticketId}.spec.ts`),
    attemptHistory: values.attemptHistory || [],
    currentStep: values.currentStep || "",
  };

  await job.updateProgress(100);
  return result;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ── Worker Factory ─────────────────────────────────────────────────────────

export function createWorker(concurrency: number = 1): Worker {
  const worker = new Worker(QUEUE_NAME, processRun, {
    connection: { url: REDIS_URL },
    concurrency,
    lockDuration: 600_000,         // 10 min — covers most DeepSeek runs
    stalledInterval: 120_000,      // 2 min stall check
    maxStalledCount: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed: ${job.data.ticketId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed: ${job?.data?.ticketId} — ${err.message}`);
  });

  worker.on("error", (err) => {
    // BullMQ will emit this on connection issues etc.
    console.error(`🔥 Worker error: ${err.message}`);
  });

  return worker;
}
