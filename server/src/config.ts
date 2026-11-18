import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type OpencodeMode = "embedded" | "remote";
export type LogLevelName = "debug" | "info" | "warn" | "error";

export interface ServerConfig {
  host: string;
  port: number;
  appAuthToken: string;
  allowedOrigins: string[];
  workspaceRoot: string;
  opencodeMode: OpencodeMode;
  opencodeBaseUrl?: string;
  opencodeModel?: string;
  opencodeProviderApiKey?: string;
  opencodeServerPassword?: string;
  opencodeDataDir: string;
  logLevel: LogLevelName;
  trustProxy: boolean;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid server configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const MODEL_PATTERN = /^[^\s/]+\/.+$/;
const ORIGIN_PATTERN = /^https?:\/\/[^\s/]+$/i;

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65_535).default(8787),
  ),
  APP_AUTH_TOKEN: z.string().trim().min(16, "must be at least 16 characters"),
  ALLOWED_ORIGINS: z.string().trim().min(1),
  WORKSPACE_ROOT: z.string().trim().min(1),
  OPENCODE_MODE: z.enum(["embedded", "remote"]).default("embedded"),
  OPENCODE_BASE_URL: optionalString,
  OPENCODE_MODEL: optionalString,
  OPENCODE_PROVIDER_API_KEY: optionalString,
  OPENCODE_SERVER_PASSWORD: optionalString,
  OPENCODE_DATA_DIR: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TRUST_PROXY: z.preprocess((value) => {
    if (value === undefined || value === "") return undefined;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
    return value;
  }, z.boolean().default(false)),
});

export function parseAllowedOrigins(raw: string): string[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const issues: string[] = [];
  if (values.length === 0) {
    throw new ConfigError(["ALLOWED_ORIGINS: at least one origin is required"]);
  }

  const origins: string[] = [];
  for (const value of values) {
    if (value === "*") {
      issues.push("ALLOWED_ORIGINS: wildcard origins are not allowed");
      continue;
    }
    const normalized = value.replace(/\/+$/, "");
    if (!ORIGIN_PATTERN.test(normalized)) {
      issues.push(`ALLOWED_ORIGINS: "${value}" must be an origin like https://app.example.com`);
      continue;
    }
    try {
      const url = new URL(normalized);
      if (url.origin !== normalized) {
        throw new Error("not an origin");
      }
      origins.push(url.origin);
    } catch {
      issues.push(`ALLOWED_ORIGINS: "${value}" must be an origin like https://app.example.com`);
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return [...new Set(origins)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => {
        const key = issue.path.map(String).join(".");
        return key ? `${key}: ${issue.message}` : issue.message;
      }),
    );
  }

  const value = parsed.data;
  const issues: string[] = [];

  let allowedOrigins: string[] = [];
  try {
    allowedOrigins = parseAllowedOrigins(value.ALLOWED_ORIGINS);
  } catch (error) {
    issues.push(...(error instanceof ConfigError ? error.issues : [String(error)]));
  }

  const workspaceRoot = path.resolve(value.WORKSPACE_ROOT);
  try {
    if (!statSync(workspaceRoot).isDirectory()) {
      issues.push(`WORKSPACE_ROOT: ${workspaceRoot} is not a directory`);
    }
  } catch {
    issues.push(`WORKSPACE_ROOT: ${workspaceRoot} does not exist`);
  }

  let opencodeBaseUrl: string | undefined;
  if (value.OPENCODE_BASE_URL !== undefined) {
    try {
      const url = new URL(value.OPENCODE_BASE_URL);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      opencodeBaseUrl = url.toString().replace(/\/$/, "");
    } catch {
      issues.push("OPENCODE_BASE_URL: must be an http(s) URL");
    }
  }

  if (value.OPENCODE_MODE === "remote" && value.OPENCODE_BASE_URL === undefined) {
    issues.push("OPENCODE_BASE_URL: required when OPENCODE_MODE=remote");
  }
  if (value.OPENCODE_MODE === "embedded" && value.OPENCODE_BASE_URL !== undefined) {
    issues.push("OPENCODE_BASE_URL: only valid when OPENCODE_MODE=remote");
  }
  if (value.OPENCODE_MODEL !== undefined && !MODEL_PATTERN.test(value.OPENCODE_MODEL)) {
    issues.push("OPENCODE_MODEL: must look like provider/model");
  }
  if (value.OPENCODE_PROVIDER_API_KEY !== undefined && value.OPENCODE_MODEL === undefined) {
    issues.push("OPENCODE_MODEL: required when OPENCODE_PROVIDER_API_KEY is set");
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return {
    host: value.HOST,
    port: value.PORT,
    appAuthToken: value.APP_AUTH_TOKEN,
    allowedOrigins,
    workspaceRoot,
    opencodeMode: value.OPENCODE_MODE,
    ...(opencodeBaseUrl !== undefined ? { opencodeBaseUrl } : {}),
    ...(value.OPENCODE_MODEL !== undefined ? { opencodeModel: value.OPENCODE_MODEL } : {}),
    ...(value.OPENCODE_PROVIDER_API_KEY !== undefined
      ? { opencodeProviderApiKey: value.OPENCODE_PROVIDER_API_KEY }
      : {}),
    ...(value.OPENCODE_SERVER_PASSWORD !== undefined
      ? { opencodeServerPassword: value.OPENCODE_SERVER_PASSWORD }
      : {}),
    opencodeDataDir: path.resolve(
      value.OPENCODE_DATA_DIR ?? defaultOpencodeDataDir(),
    ),
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
  };
}

function defaultOpencodeDataDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".data",
    "opencode",
  );
}
