import { env } from "../config/env";
import { sanitizeErrorMessage } from "../security/error";

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type ProviderName = "deepseek" | "openai" | "anthropic";

export async function callLLM(
  messages: LLMMessage[],
  config?: Partial<LLMConfig>
): Promise<string> {
  const preferredProvider = resolveProvider();
  switch (preferredProvider) {
    case "openai":
      return callOpenAI(messages, config);
    case "anthropic":
      return callAnthropic(messages, config);
    case "deepseek":
    default:
      return callDeepSeek(messages, config);
  }
}

export function selectProvider(configured: ProviderName, keys: {
  deepseek?: string;
  openai?: string;
  anthropic?: string;
}): ProviderName {
  if (configured === "deepseek" && keys.deepseek) return "deepseek";
  if (configured === "openai" && keys.openai) return "openai";
  if (configured === "anthropic" && keys.anthropic) return "anthropic";
  if (keys.deepseek) return "deepseek";
  if (keys.openai) return "openai";
  if (keys.anthropic) return "anthropic";
  throw new Error("No LLM API key configured. Set DEEPSEEK_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.");
}

function resolveProvider(): ProviderName {
  return selectProvider(env.LLM_PROVIDER, {
    deepseek: env.DEEPSEEK_API_KEY,
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  });
}

async function callDeepSeek(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<string> {
  const model = config?.model || env.LLM_MODEL;
  const temperature = config?.temperature ?? 0.3;
  const maxTokens = config?.maxTokens ?? 4096;
  const baseUrl = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`DeepSeek API error (${response.status}): ${sanitizeErrorMessage(errorText)}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty response");
  return content.trim();
}

async function callOpenAI(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config?.model || env.LLM_MODEL || "gpt-4.1-mini",
      messages,
      temperature: config?.temperature ?? 0.3,
      max_tokens: config?.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`OpenAI API error (${response.status}): ${sanitizeErrorMessage(errorText)}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  return content.trim();
}

async function callAnthropic(messages: LLMMessage[], config?: Partial<LLMConfig>): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const nonSystem = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config?.model || env.LLM_MODEL || "claude-3-5-sonnet-latest",
      temperature: config?.temperature ?? 0.3,
      max_tokens: config?.maxTokens ?? 4096,
      system,
      messages: nonSystem,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`Anthropic API error (${response.status}): ${sanitizeErrorMessage(errorText)}`);
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = data.content?.find((c) => c.type === "text")?.text;
  if (!content) throw new Error("Anthropic returned empty response");
  return content.trim();
}
