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

const PORT = parseInt(process.env.PONIMI_PORT || "3123", 10);
const HOST = process.env.PONIMI_HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "ponimi-webhook" }));
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
      const body = await readBody(req);
      const { ticketId, mode = "auto" } = JSON.parse(body);

      if (!ticketId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing ticketId" }));
        return;
      }

      const validModes = ["manual", "semi-autonomous", "autonomous"];
      const resolvedMode = mode === "semi" ? "semi-autonomous"
        : mode === "auto" ? "autonomous"
        : validModes.includes(mode) ? mode
        : "autonomous";

      const jobId = await enqueueJob(ticketId, resolvedMode as any);

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobId, ticketId, mode: resolvedMode }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`🦄 Ponini Webhook Server listening on http://${HOST}:${PORT}`);
  console.log(`   POST /run       — { ticketId, mode }`);
  console.log(`   GET  /status/:id — job status`);
  console.log(`   GET  /health     — ping`);
});
