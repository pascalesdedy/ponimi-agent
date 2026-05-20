import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  // LLM Provider — prioritize DeepSeek, fallback OpenAI/Anthropic
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Which LLM to use as default
  LLM_PROVIDER: z.enum(['deepseek', 'openai', 'anthropic']).default('deepseek'),

  LLM_MODEL: z.string().default('deepseek-chat'),

  // Redis (for queue)
  REDIS_URL: z.string().default('redis://:ponimi-dev-password@localhost:6379'),

  // Integrations (optional)
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_DOMAIN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  // Use mock data instead of calling LLM (for testing)
  LLM_MOCK: z.coerce.boolean().default(false),

  // Environment
  MODE: z.enum(['development', 'production']).default('development'),

  // Webhook security
  WEBHOOK_API_KEY: z.string().default('change-me-webhook-key'),
  PONIMI_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().positive().default(65536),
  WEBHOOK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  // Retention
  CHECKPOINT_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
