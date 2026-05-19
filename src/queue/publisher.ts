import { Queue } from "bullmq";
import { env } from "../config/env";

const REDIS_URL = env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ponimi-jobs";

export const qaQueue = new Queue(QUEUE_NAME, {
  connection: { url: REDIS_URL },
});

export interface QueuedJob {
  ticketId: string;
  mode: "manual" | "semi-autonomous" | "autonomous";
  targetUrl?: string;
  submittedAt: string;
}

/**
 * Add a QA job to the queue.
 * Returns the job ID for status tracking.
 */
export async function enqueueJob(
  ticketId: string,
  mode: "manual" | "semi-autonomous" | "autonomous" = "autonomous",
  targetUrl?: string
): Promise<string> {
  const job = await qaQueue.add(
    "qa-run",
    {
      ticketId,
      mode,
      targetUrl: targetUrl || "",
      submittedAt: new Date().toISOString(),
    } satisfies QueuedJob,
    {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );
  return job.id ?? "unknown";
}

/**
 * Get job status from BullMQ.
 */
export async function getJobStatus(
  jobId: string
): Promise<{
  status: "waiting" | "active" | "completed" | "failed";
  result?: Record<string, unknown>;
  failedReason?: string;
} | null> {
  const { Job } = await import("bullmq");
  const job = await Job.fromId(qaQueue, jobId);
  if (!job) return null;

  const state = await job.getState();
  const validStatus = state as "waiting" | "active" | "completed" | "failed";

  return {
    status: validStatus,
    result: (job.returnvalue as Record<string, unknown> | undefined) ?? undefined,
    failedReason: job.failedReason ?? undefined,
  };
}
