export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return raw
    .replace(/[A-Za-z]:\\[^\s)]+/g, "<redacted-path>")
    .replace(/\/[^\s)]+/g, (m) => (m.includes("http") ? m : "<redacted-path>"))
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "<redacted-key>")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted-token>")
    .slice(0, 500);
}

