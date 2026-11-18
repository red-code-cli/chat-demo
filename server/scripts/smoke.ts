/**
 * Manual smoke test against real OpenCode and a real provider key.
 *
 * Not part of CI. Run from the repository root:
 *
 *   pnpm --filter @redcode/server smoke
 *
 * It loads server/.env, boots the gateway in-process, creates a session,
 * subscribes to its event stream, sends one short prompt, and prints the
 * assistant text. Tokens and prompts are never logged by the server; this
 * script only prints the assistant result.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { ConfigError, loadConfig, type ServerConfig } from "../src/config.js";
import { createLogger, safeError } from "../src/logger.js";
import { createGateway } from "../src/opencode/factory.js";
import type { SdkEvent } from "../src/opencode/types.js";

const PROMPT = "Reply with exactly one word: pong";
const TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  loadEnvFile();

  const config = loadConfig(process.env);
  assertSmokeConfig(config);

  const logger = createLogger({ level: config.logLevel });
  const gateway = createGateway(config, logger);
  const { app, sseHub } = createApp({ config, gateway, logger, sseHeartbeatMs: 15_000 });
  const auth = { Authorization: `Bearer ${config.appAuthToken}` };
  let sessionID: string | undefined;

  try {
    await gateway.start();
    console.log(`OpenCode mode: ${gateway.mode}`);

    const created = await requestJson(app, "/api/v1/sessions", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "RedCode smoke test" }),
    });
    sessionID = readSessionId(created);
    console.log(`Session: ${sessionID}`);

    const controller = new AbortController();
    const eventsResponse = await app.request(
      `/api/v1/events?session=${encodeURIComponent(sessionID)}`,
      { headers: auth, signal: controller.signal },
    );
    if (!eventsResponse.ok || eventsResponse.body === null) {
      throw new Error(`Event stream failed with HTTP ${eventsResponse.status}`);
    }

    const prompted = await requestJson(app, `/api/v1/sessions/${sessionID}/prompt`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: PROMPT }),
    });
    if (prompted["accepted"] !== true) {
      throw new Error("Prompt was not accepted");
    }

    const result = await collectReply({
      reader: eventsResponse.body.getReader(),
      sessionID,
      app,
      auth,
      timeoutMs: TIMEOUT_MS,
    });
    controller.abort();

    console.log(`Finished: ${result.reason}`);
    console.log("Assistant reply:");
    console.log(result.text.length > 0 ? result.text : "(no text parts received)");

    if (
      result.reason === "timeout" ||
      result.reason.startsWith("session error") ||
      result.text.length === 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    sseHub.closeAll();
    if (sessionID !== undefined) {
      await Promise.resolve(
        app.request(`/api/v1/sessions/${sessionID}`, {
          method: "DELETE",
          headers: auth,
        }),
      ).catch(() => undefined);
    }
    await gateway.stop();
  }
}

function loadEnvFile(): void {
  const envPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".env",
  );
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

function assertSmokeConfig(config: ServerConfig): void {
  if (config.opencodeModel === undefined) {
    throw new Error("OPENCODE_MODEL is required for the smoke test (format: provider/model)");
  }
  if (config.opencodeMode === "embedded" && config.opencodeProviderApiKey === undefined) {
    throw new Error(
      "OPENCODE_PROVIDER_API_KEY is required for embedded smoke tests; remote mode can use server-side auth instead",
    );
  }
}

async function requestJson(
  app: ReturnType<typeof createApp>["app"],
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await app.request(url, init);
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Fall through to the HTTP error below.
  }

  if (!response.ok) {
    const error = body["error"] as { code?: string; message?: string } | undefined;
    throw new Error(
      `HTTP ${response.status} ${error?.code ?? "UNKNOWN"}: ${error?.message ?? "request failed"}`,
    );
  }
  return body;
}

function readSessionId(body: Record<string, unknown>): string {
  const session = body["session"] as { id?: unknown } | undefined;
  if (typeof session?.id !== "string" || session.id.length === 0) {
    throw new Error("Create session response did not contain a session id");
  }
  return session.id;
}

interface CollectOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  sessionID: string;
  app: ReturnType<typeof createApp>["app"];
  auth: Record<string, string>;
  timeoutMs: number;
}

async function collectReply(options: CollectOptions): Promise<{
  text: string;
  reason: string;
}> {
  const decoder = new TextDecoder();
  const parts = new Map<string, string>();
  const deadline = Date.now() + options.timeoutMs;
  let buffer = "";

  try {
    while (Date.now() < deadline) {
      const { done, value } = await readWithTimeout(
        options.reader,
        Math.max(1, deadline - Date.now()),
      );
      if (done) {
        return { text: joinParts(parts), reason: "event stream closed" };
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const event = parseSseFrame(frame);
        if (event === undefined) {
          continue;
        }
        const outcome = await handleEvent(event, options, parts);
        if (outcome !== undefined) {
          return { text: joinParts(parts), reason: outcome };
        }
      }
    }
    return { text: joinParts(parts), reason: "timeout" };
  } finally {
    await options.reader.cancel().catch(() => undefined);
  }
}

async function handleEvent(
  event: SdkEvent,
  options: CollectOptions,
  parts: Map<string, string>,
): Promise<string | undefined> {
  const properties = event.properties as unknown as Record<string, unknown>;

  switch (event.type) {
    case "message.part.updated": {
      const part = properties["part"] as Record<string, unknown> | undefined;
      if (part?.["type"] === "text" && typeof part["text"] === "string") {
        const id = typeof part["id"] === "string" ? part["id"] : `part-${parts.size}`;
        parts.set(id, part["text"]);
      }
      return undefined;
    }
    case "permission.updated": {
      const permissionID = properties["id"];
      if (typeof permissionID === "string") {
        console.log("Permission requested; rejecting it in the smoke test.");
        await requestJson(
          options.app,
          `/api/v1/sessions/${options.sessionID}/permissions/${encodeURIComponent(permissionID)}`,
          {
            method: "POST",
            headers: { ...options.auth, "Content-Type": "application/json" },
            body: JSON.stringify({ response: "reject" }),
          },
        );
      }
      return undefined;
    }
    case "session.error": {
      const error = properties["error"] as Record<string, unknown> | undefined;
      const name = typeof error?.["name"] === "string" ? error["name"] : "UnknownError";
      return `session error (${name})`;
    }
    case "session.idle":
      return "session idle";
    default:
      return undefined;
  }
}

function parseSseFrame(frame: string): SdkEvent | undefined {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(dataLines.join("\n")) as SdkEvent;
  } catch {
    return undefined;
  }
}

function joinParts(parts: Map<string, string>): string {
  return [...parts.values()].join("\n\n").trim();
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for OpenCode events"));
    }, timeoutMs);

    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error("Smoke test failed:", safeError(error));
  }
  process.exitCode = 1;
});
