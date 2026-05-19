import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
}

export interface ParsedTestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  failures: Array<{
    test: string;
    error: string;
    location?: string;
  }>;
}

/** Check if Docker sandbox is available */
export function isSandboxAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if sandbox image is built */
export function isSandboxImageBuilt(): boolean {
  try {
    const images = execSync("docker images --format '{{.Repository}}:{{.Tag}}'", {
      encoding: "utf-8",
      timeout: 5000,
    });
    return images.includes("ponimi-playwright");
  } catch {
    return false;
  }
}

/** Build the Playwright sandbox image */
export async function buildSandboxImage(): Promise<string> {
  const buildPath = path.resolve(process.cwd(), "docker");
  const dockerfile = path.join(buildPath, "Dockerfile.playwright");

  if (!fs.existsSync(dockerfile)) {
    throw new Error(`Dockerfile not found: ${dockerfile}`);
  }

  const output = execSync(
    `docker build -f ${dockerfile} -t ponimi-playwright:latest --rm ${path.resolve(process.cwd())}`,
    { encoding: "utf-8", timeout: 300000 } // 5 min timeout for build
  );

  return output;
}

/**
 * Run Playwright tests in Docker sandbox.
 * Mounts the workspace as a volume, executes the test script.
 */
export async function runInSandbox(
  scriptPath: string,
  outputDir: string,
  timeoutMs: number = 60000
): Promise<SandboxResult> {
  const absoluteScriptPath = path.resolve(scriptPath);
  const absoluteOutputDir = path.resolve(outputDir);
  const workspaceDir = path.resolve(process.cwd());

  if (!fs.existsSync(absoluteScriptPath)) {
    return {
      stdout: "",
      stderr: `Script not found: ${absoluteScriptPath}`,
      exitCode: 1,
      success: false,
      timedOut: false,
    };
  }

  return new Promise((resolve) => {
    const container = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--network", "host",
        "--memory", "256m",
        "--memory-swap", "384m",
        "--cpus", "1",
        "-v", `${workspaceDir}:/workspace:ro`,
        "-v", `${absoluteOutputDir}:/workspace/output`,
        "ponimi-playwright:latest",
        "/usr/local/bin/run-playwright.sh",
        `/workspace/${path.relative(workspaceDir, absoluteScriptPath)}`,
      ],
      {
        timeout: timeoutMs + 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    container.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    container.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      container.kill("SIGKILL");
    }, timeoutMs);

    container.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!timedOut) {
        resolve({
          stdout,
          stderr,
          exitCode,
          success: exitCode === 0,
          timedOut: false,
        });
      } else {
        resolve({
          stdout,
          stderr: stderr + "\n⏱️ Timed out after " + (timeoutMs / 1000) + "s",
          exitCode: null,
          success: false,
          timedOut: true,
        });
      }
    });

    container.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + "\n" + err.message,
        exitCode: 1,
        success: false,
        timedOut: false,
      });
    });
  });
}

/** Check if Playwright is available natively (without sandbox) */
export function isPlaywrightAvailableNative(): boolean {
  try {
    execSync("npx playwright --version", {
      stdio: "ignore",
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Auto-detect: prefer sandbox (isolated), fallback to native, fallback to none */
export function getBestExecutor(): "sandbox" | "native" | "none" {
  if (isSandboxAvailable() && isSandboxImageBuilt()) {
    return "sandbox";
  }
  if (isPlaywrightAvailableNative()) {
    return "native";
  }
  return "none";
}

/**
 * Wait for sandbox image to be built.
 * Returns true if available, false if still building or unavailable.
 */
export async function ensureSandboxImage(timeoutMs: number = 300000): Promise<boolean> {
  if (isSandboxImageBuilt()) return true;
  if (!isSandboxAvailable()) return false;

  try {
    await buildSandboxImage();
    return true;
  } catch (err) {
    console.error("Failed to build sandbox image:", err);
    return false;
  }
}
