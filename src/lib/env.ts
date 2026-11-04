import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.enum(["whisper-large-v3-turbo", "whisper-large-v3"]).default("whisper-large-v3-turbo"),
  GROQ_LLM_MODEL: z.string().default("llama-3.3-70b-versatile"),
  STORAGE_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(500),
  MAX_VIDEO_MINUTES: z.coerce.number().positive().default(30),
  DEFAULT_CREDITS: z.coerce.number().int().nonnegative().default(10),
  RENDER_RETENTION_DAYS: z.coerce.number().positive().default(7),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Clipnova <no-reply@example.com>"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated lazily so `next build` does not need runtime secrets. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
      throw new Error(`Invalid environment configuration: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
