import { env } from "../config/env";

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Unified LLM provider — calls DeepSeek API directly.
 * No LangChain dependency. Just raw fetch. Simple, cheap, fast.
 */
export async function callLLM(
  messages: LLMMessage[],
  config?: Partial<LLMConfig>
): Promise<string> {
  const model = config?.model || env.LLM_MODEL;
  const temperature = config?.temperature ?? 0.3; // Low temp for deterministic test gen
  const maxTokens = config?.maxTokens ?? 4096;

  const baseUrl = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const apiKey = env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY not set. " +
      "Create a .env file in the project root with:\n" +
      "DEEPSEEK_API_KEY=sk-your-key-here"
    );
  }

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
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM returned empty response");
  }

  return content.trim();
}
