export type LogLevelName = "debug" | "info" | "warn" | "error";

const LEVEL_VALUE: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_KEY_PATTERN = /authorization|token|secret|password|api[-_]?key|cookie/i;
const SECRET_VALUE_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_QUERY_PATTERN =
  /(api[-_]?key|token|secret|password)["']?\s*[:=]\s*["']?[^"'&\s,}]+/gi;

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level: LogLevelName;
  sink?: (line: string, level: LogLevelName) => void;
}

export function redactText(value: string): string {
  return value
    .replace(SECRET_VALUE_PATTERN, "$1 [redacted]")
    .replace(SECRET_QUERY_PATTERN, "$1=[redacted]")
    .slice(0, 500);
}

export function safeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: redactText(error.message),
      ...(typeof code === "string" ? { code } : {}),
    };
  }
  return { message: redactText(String(error)) };
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  }
  if (value instanceof Error) {
    return safeError(value);
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(entry, depth + 1);
    }
    return output;
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_VALUE[options.level];
  const sink =
    options.sink ??
    ((line: string, level: LogLevelName) => {
      if (level === "warn" || level === "error") {
        process.stderr.write(`${line}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    });

  const emit = (level: LogLevelName, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_VALUE[level] < threshold) {
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level,
      msg: redactText(message),
      ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
    };
    const line = JSON.stringify(entry);
    sink(line, level);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
