import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { app, autoApp } from "../agent/graph";
import { checkpointer } from "../db/sqlite";
import path from "path";
import fs from "fs";

// ── Redis connection ──────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ponimi-jobs";

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ── Queue ──────────────────────────────────────────────────────────────────
export const jobQueue = new Queue(QUEUE_NAME, { connection });

export interface QueuedJob {
  ticketId: string;
  mode: "manual" | "semi-autonomous" | "autonomous";
  submittedAt: string;
}

/**
 * Add a QA job to the queue.
 * Returns the job ID for status tracking.
 */
export async function enqueueJob(
  ticketId: string,
  mode: "manual" | "semi-autonomous" | "autonomous" = "autonomous"
): Promise<string> {
  const job = await jobQueue.add(
    "qa-run",
    {
      ticketId,
      mode,
      submittedAt: new Date().toISOString(),
    },
    {
      attempts: 1,
      removeOnComplete: 100, // Keep last 100 completed
      removeOnFail: 50, // Keep last 50 failed
    }
  );
  return job.id ?? "unknown";
}

/**
 * Get job status.
 */
export async function getJobStatus(
  jobId: string
): Promise<{
  status: "waiting" | "active" | "completed" | "failed";
  result?: Record<string, unknown>;
  failedReason?: string;
} | null> {
  // BullMQ's Job.fromId needs the queue itself to get the client
  const job = await Job.fromId(jobQueue, jobId);
  if (!job) return null;

  const state = await job.getState();
  const validStatus = state as "waiting" | "active" | "completed" | "failed";

  return {
    status: validStatus,
    result: (job.returnvalue as Record<string, unknown> | undefined) ?? undefined,
    failedReason: job.failedReason ?? undefined,
  };
}

// ── Worker ─────────────────────────────────────────────────────────────────
async function processRun(job: Job<QueuedJob>) {
  const { ticketId, mode } = job.data;
  const threadId = `thread-${ticketId}`;

  const config = {
    configurable: { thread_id: threadId },
  };

  // Ensure output dirs
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const initialState = {
    ticketData: ticketId,
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
  const stream = await activeApp.stream(initialState, config);

  let lastNodeState: Record<string, unknown> = {};

  for await (const step of stream) {
    const nodeName = Object.keys(step)[0];
    lastNodeState = step[nodeName] as Record<string, unknown>;

    if (lastNodeState?.currentStep) {
      await job.log(String(lastNodeState.currentStep));

      // Update progress based on node
      if (String(lastNodeState.currentStep).includes("Extracted")) {
        await job.updateProgress(30);
      } else if (String(lastNodeState.currentStep).includes("CSV")) {
        await job.updateProgress(50);
      } else if (String(lastNodeState.currentStep).includes("Playwright")) {
        await job.updateProgress(70);
      } else if (
        String(lastNodeState.currentStep).includes("Test") ||
        String(lastNodeState.currentStep).includes("Execution")
      ) {
        await job.updateProgress(85);
      }
    }
  }

  // Check final state
  const currentState = await activeApp.getState(config);
  const values = currentState?.values || {};

  const reportPath = path.join(outputDir, `${ticketId}-report.md`);
  const reportExists = fs.existsSync(reportPath);

  const result = {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWorker(
  concurrency: number = 1
): Worker<QueuedJob, any> {
  const worker = new Worker(QUEUE_NAME, processRun, {
    connection,
    concurrency,
    lockDuration: 600_000, // 10 min lock
    stalledInterval: 120_000, // 2 min stall check
    maxStalledCount: 3,
  });

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed: ${job.data.ticketId}`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `❌ Job ${job?.id} failed: ${job?.data?.ticketId} — ${err.message}`
    );
  });

  worker.on("error", (err) => {
    console.error(`🔥 Worker error: ${err.message}`);
  });

  return worker;
}

export async function closeWorker(): Promise<void> {
  await connection.quit();
}
