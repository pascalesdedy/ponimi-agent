import crypto from "crypto";

const TICKET_ID_REGEX = /^[A-Za-z0-9_-]{1,100}$/;

export function sanitizePromptText(input: string, maxLength: number = 2000): string {
  const normalized = input.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

export function sanitizeTargetUrl(input: string): string {
  const cleaned = sanitizePromptText(input, 1000);
  if (!cleaned) return "";

  try {
    const parsed = new URL(cleaned);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function validateTicketId(ticketId: string): boolean {
  return TICKET_ID_REGEX.test(ticketId);
}

export function assertValidTicketId(ticketId: string): string {
  if (!validateTicketId(ticketId)) {
    throw new Error("Invalid ticketId. Allowed: letters, numbers, hyphen, underscore (max 100 chars).");
  }
  return ticketId;
}

export function safeTicketFilename(ticketId: string, fallback: string = "unknown"): string {
  return validateTicketId(ticketId) ? ticketId : fallback;
}

export function generateThreadId(ticketId: string): string {
  const safeTicket = assertValidTicketId(ticketId);
  const suffix = crypto.randomBytes(6).toString("hex");
  return `thread-${safeTicket}-${suffix}`;
}

