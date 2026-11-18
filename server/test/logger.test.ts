import { describe, expect, it } from "vitest";
import { createLogger, redactText, safeError } from "../src/logger.js";

describe("redaction", () => {
  it("redacts bearer and basic credentials", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redactText("Basic dXNlcjpwYXNz")).toBe("Basic [redacted]");
  });

  it("redacts secrets in query strings", () => {
    expect(redactText("GET /x?api_key=secret&token=abc&page=1")).toBe(
      "GET /x?api_key=[redacted]&token=[redacted]&page=1",
    );
  });

  it("redacts secrets in JSON-ish error text", () => {
    const redacted = redactText('request failed: {"apiKey":"sk-secret","name":"x"}');
    expect(redacted).not.toContain("sk-secret");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts error messages", () => {
    const error = safeError(new Error("failed with Bearer abc.def.ghi"));
    expect(error.message).toBe("failed with Bearer [redacted]");
  });
});

describe("structured logger", () => {
  it("writes JSON and redacts secret fields", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", sink: (line) => lines.push(line) });

    logger.info("request", {
      requestId: "req-1",
      authorization: "Bearer super-secret-token",
      nested: { apiKey: "sk-secret", path: "/api/v1/sessions" },
      note: "Bearer abc.def.ghi",
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("request");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.authorization).toBe("[redacted]");
    expect((parsed.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((parsed.nested as Record<string, unknown>).path).toBe("/api/v1/sessions");
    expect(parsed.note).toBe("Bearer [redacted]");
    expect(lines[0]).not.toContain("super-secret-token");
    expect(lines[0]).not.toContain("sk-secret");
  });

  it("drops messages below the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", sink: (line) => lines.push(line) });
    logger.debug("debug message");
    logger.info("info message");
    expect(lines).toHaveLength(0);
  });

  it("bounds log payloads", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", sink: (line) => lines.push(line) });
    logger.info("large", { value: "x".repeat(2_000) });

    const parsed = JSON.parse(lines[0] as string) as { value: string };
    expect(parsed.value.length).toBeLessThanOrEqual(500);
  });
});
