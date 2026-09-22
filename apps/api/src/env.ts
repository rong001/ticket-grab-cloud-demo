const DEV_JWT_DEFAULTS = [
  "dev-only-change-me-ticket-grab-cloud",
  "change-me-to-a-long-random-string-in-production",
  "compose-dev-change-me-please",
  "dev-e2e-test-secret-ticket-grab-cloud",
  "change-me",
];

const DEV_ENC_DEFAULTS = [
  "",
  "change-me-to-a-long-random-encryption-key",
  "dev-encryption-key-ticket-grab-cloud",
  "change-me",
];

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function looksWeak(secret: string, denylist: string[]): boolean {
  const s = secret.trim();
  if (s.length < 24) return true;
  const lower = s.toLowerCase();
  if (denylist.some((d) => d && lower === d.toLowerCase())) return true;
  if (/^(change-?me|dev|test|secret|password|example)/i.test(s)) return true;
  return false;
}

/** Fail hard in production when secrets are still defaults / weak. */
export function assertProductionSecrets(nodeEnv: string, jwtSecret: string, encryptionKey: string) {
  if (nodeEnv !== "production") return;
  const errors: string[] = [];
  if (looksWeak(jwtSecret, DEV_JWT_DEFAULTS)) {
    errors.push(
      "JWT_SECRET is missing, too short (<24), or still a known dev/default value. Set a strong random secret before production."
    );
  }
  if (looksWeak(encryptionKey, DEV_ENC_DEFAULTS)) {
    errors.push(
      "ENCRYPTION_KEY is missing, too short (<24), or still a known dev/default value. Required in production for traveler IDs + session cookies."
    );
  }
  if (errors.length) {
    throw new Error(`[production env] ${errors.join(" ")}`);
  }
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = required("JWT_SECRET", "dev-only-change-me-ticket-grab-cloud");
const encryptionKey = process.env.ENCRYPTION_KEY ?? "";

assertProductionSecrets(nodeEnv, jwtSecret, encryptionKey);

export const env = {
  nodeEnv,
  host: process.env.API_HOST ?? "0.0.0.0",
  port: Number(process.env.API_PORT ?? 3001),
  databaseUrl: required("DATABASE_URL", "postgresql://ticket:ticket@localhost:5432/ticket_grab?schema=public"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  /** Comma-separated list of allowed web origins. */
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  providerMode: (process.env.PROVIDER_MODE as "live" | "fixture") ?? "fixture",
  /** Public web origin for in-product checkout / payment handoff links. */
  webBaseUrl: process.env.WEB_BASE_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:3000",
  /** AES key material for session cookies / traveler IDs. Empty = plain: prefix (dev only). */
  encryptionKey,
  /** Public self-register for ToC. Default ON; set ALLOW_PUBLIC_REGISTER=0 to disable.
   *  Read at request time so tests can flip the flag after module load. */
  get allowPublicRegister() {
    const v = process.env.ALLOW_PUBLIC_REGISTER;
    if (v === undefined || v === "") return true;
    return v !== "0" && v.toLowerCase() !== "false";
  },
};
