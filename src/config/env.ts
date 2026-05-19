import { z } from 'zod';
import dotenv from 'dotenv';

// Muat variabel environment dari .env
dotenv.config();

// Definisi skema Environment Variables menggunakan Zod
const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_DOMAIN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  MODE: z.enum(['development', 'production']).default('development'),
});

// Validasi environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Konfigurasi Environment Variable tidak valid:');
  console.error(parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
