#!/usr/bin/env node
/**
 * Ponimi Webhook Server
 *
 * Exposes an HTTP endpoint so OpenClaw or external tools can trigger
 * Ponimi QA runs without a full CLI invocation.
 *
 * Usage:
 *   node dist/scripts/webhook-server.js
 *   POST /run     { ticketId: "PROJ-123", mode: "auto" }
 *   GET  /status/:jobId
 *   GET  /health
 */
import http from "http";
import { enqueueJob, getJobStatus } from "../queue/publisher";
import { env } from "../config/env";
import { z } from "zod";
import { assertValidTicketId, sanitizePromptText, sanitizeTargetUrl } from "../security/input";
import { sanitizeErrorMessage } from "../security/error";
import Redis from "ioredis";
import { logger } from "../logging/logger";

const PORT = parseInt(process.env.PONIMI_PORT || "3123", 10);
const HOST = process.env.PONIMI_HOST || "127.0.0.1";
const MAX_BODY_BYTES = env.WEBHOOK_MAX_BODY_BYTES;
const ALLOWED_ORIGINS = env.PONIMI_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
const RATE_LIMIT_PER_MIN = env.WEBHOOK_RATE_LIMIT_PER_MINUTE;
const rateLimitStore = new Map<string, number[]>();

const runPayloadSchema = z.object({
  ticketId: z.string().min(1).max(100),
  mode: z.enum(["manual", "semi", "auto", "semi-autonomous", "autonomous"]).optional(),
  targetUrl: z.string().optional(),
  description: z.string().optional(),
});

function isAuthorized(req: http.IncomingMessage): boolean {
  const headerKey = req.headers["x-ponimi-key"];
  if (typeof headerKey !== "string") return false;
  return Boolean(env.WEBHOOK_API_KEY) && headerKey === env.WEBHOOK_API_KEY;
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Ponimi-Key");
}

function checkRateLimit(req: http.IncomingMessage): boolean {
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const history = rateLimitStore.get(ip) || [];
  const recent = history.filter((t) => t > oneMinuteAgo);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    rateLimitStore.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return true;
}

async function llmReachable(): Promise<boolean> {
  const base =
    env.LLM_PROVIDER === "openai"
      ? "https://api.openai.com"
      : env.LLM_PROVIDER === "anthropic"
        ? "https://api.anthropic.com"
        : env.DEEPSEEK_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(base, { method: "GET", signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function redisReachable(): Promise<boolean> {
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Parse URL ──────────────────────────────────────────────────
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const path = url.pathname;

  try {
    // GET /health
    if (req.method === "GET" && path === "/health") {
      const [redisOk, llmOk] = await Promise.all([redisReachable(), llmReachable()]);
      const degraded = !redisOk || !llmOk;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: degraded ? "degraded" : "ok",
        service: "ponimi-webhook",
        dependencies: {
          redis: redisOk ? "ok" : "down",
          llm: llmOk ? "ok" : "down",
        },
      }));
      return;
    }

    // GET /status/:jobId
    if (req.method === "GET" && path.startsWith("/status/")) {
      const jobId = path.split("/")[2];
      if (!jobId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing jobId" }));
        return;
      }
      const status = await getJobStatus(jobId);
      res.writeHead(status ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status || { error: "Job not found" }));
      return;
    }

    // POST /run
    if (req.method === "POST" && path === "/run") {
      if (!checkRateLimit(req)) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Rate limit exceeded" }));
        return;
      }

      if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const contentType = req.headers["content-type"] || "";
      if (!String(contentType).toLowerCase().includes("application/json")) {
        res.writeHead(415, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Content-Type must be application/json" }));
        return;
      }

      const body = await readBody(req, MAX_BODY_BYTES);
      const payload = runPayloadSchema.parse(JSON.parse(body));

      const ticketId = assertValidTicketId(payload.ticketId);
      const mode = payload.mode || "auto";
      const validModes = ["manual", "semi-autonomous", "autonomous"] as const;
      const resolvedMode = mode === "semi" ? "semi-autonomous"
        : mode === "auto" ? "autonomous"
          : validModes.includes(mode as typeof validModes[number]) ? mode as typeof validModes[number]
            : "autonomous";

      const jobId = await enqueueJob(
        ticketId,
        resolvedMode,
        sanitizeTargetUrl(payload.targetUrl || ""),
        sanitizePromptText(payload.description || "", 2000)
      );

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobId, ticketId, mode: resolvedMode }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));

  } catch (err) {
    if (err instanceof z.ZodError || err instanceof SyntaxError) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request payload" }));
      return;
    }
    if (err instanceof Error && err.message.includes("Payload too large")) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    const msg = sanitizeErrorMessage(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
});

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        done = true;
        reject(new Error(`Payload too large (max ${maxBytes} bytes)`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

server.listen(PORT, HOST, () => {
  logger.info("webhook server started", {
    host: HOST,
    port: PORT,
    endpoints: ["/run", "/status/:id", "/health"],
  });
});

