import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Event } from "@opencode-ai/sdk";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { GatewayError } from "../src/errors.js";
import { createLogger } from "../src/logger.js";
import type {
  GatewayHealth,
  ModelRef,
  OpencodeGateway,
  PermissionResponse,
  ProviderSummary,
  SessionSummary,
  SdkEvent,
} from "../src/opencode/types.js";
import type { SseHub } from "../src/sse.js";
import type { AppBindings } from "../src/types.js";

export const TEST_TOKEN = "test-token-0123456789abcdef";
export const TEST_ORIGIN = "http://localhost:8080";

export interface TempWorkspace {
  root: string;
  project: string;
  cleanup(): void;
}

export function createTempWorkspace(): TempWorkspace {
  const root = mkdtempSync(path.join(tmpdir(), "redcode-test-"));
  const project = path.join(root, "project");
  mkdirSync(project);
  writeFileSync(path.join(project, "README.md"), "# test\n");
  writeFileSync(path.join(root, "outside.txt"), "secret\n");

  return {
    root,
    project,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function createSymlinkEscape(workspace: TempWorkspace): string {
  const link = path.join(workspace.root, "escape");
  symlinkSync(path.dirname(workspace.root), link, "dir");
  return link;
}

export function testConfig(workspaceRoot: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    appAuthToken: TEST_TOKEN,
    allowedOrigins: [TEST_ORIGIN],
    workspaceRoot,
    opencodeMode: "embedded",
    opencodeDataDir: path.join(workspaceRoot, ".data"),
    logLevel: "error",
    trustProxy: false,
    ...overrides,
  };
}

export function authHeaders(token: string = TEST_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function fakeEvent(type: string, properties: Record<string, unknown>): Event {
  return { type, properties } as unknown as Event;
}

export class MockGateway implements OpencodeGateway {
  readonly mode = "embedded";
  healthy = true;
  healthMessage: string | undefined;
  providers: ProviderSummary[] = [];
  sessions: SessionSummary[] = [];

  readonly createdSessions: Array<{ title?: string; directory?: string }> = [];
  readonly prompts: Array<{
    sessionID: string;
    text: string;
    model?: ModelRef;
    directory?: string;
  }> = [];
  readonly permissionReplies: Array<{
    sessionID: string;
    permissionID: string;
    response: PermissionResponse;
    directory?: string;
  }> = [];
  readonly abortedSessions: string[] = [];
  readonly deletedSessions: string[] = [];
  readonly subscriptionSignals: AbortSignal[] = [];
  readonly listDirectories: Array<string | undefined> = [];

  eventsFactory: (input: { signal: AbortSignal; directory?: string }) => AsyncIterable<SdkEvent> =
    async function* emptyEvents(): AsyncIterable<SdkEvent> {
      return;
    };

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  health(): Promise<GatewayHealth> {
    return Promise.resolve({
      mode: "embedded",
      healthy: this.healthy,
      ...(this.healthMessage !== undefined ? { message: this.healthMessage } : {}),
    });
  }

  listProviders(): Promise<ProviderSummary[]> {
    return Promise.resolve(this.providers);
  }

  createSession(input: { title?: string; directory?: string }): Promise<SessionSummary> {
    this.createdSessions.push(input);
    const session: SessionSummary = {
      id: `ses_${this.createdSessions.length}`,
      title: input.title ?? "New session",
      directory: input.directory ?? "",
      time: { created: Date.now(), updated: Date.now() },
    };
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  listSessions(input?: { directory?: string }): Promise<SessionSummary[]> {
    this.listDirectories.push(input?.directory);
    return Promise.resolve(this.sessions);
  }

  getSession(id: string): Promise<SessionSummary> {
    const session = this.sessions.find((entry) => entry.id === id);
    if (session === undefined) {
      throw new GatewayError("OPENCODE_NOT_FOUND", "OpenCode resource not found.", 404);
    }
    return Promise.resolve(session);
  }

  deleteSession(id: string): Promise<boolean> {
    this.deletedSessions.push(id);
    this.sessions = this.sessions.filter((entry) => entry.id !== id);
    return Promise.resolve(true);
  }

  promptAsync(input: {
    sessionID: string;
    text: string;
    model?: ModelRef;
    directory?: string;
  }): Promise<void> {
    this.prompts.push(input);
    return Promise.resolve();
  }

  abortSession(id: string): Promise<boolean> {
    this.abortedSessions.push(id);
    return Promise.resolve(true);
  }

  replyPermission(input: {
    sessionID: string;
    permissionID: string;
    response: PermissionResponse;
    directory?: string;
  }): Promise<boolean> {
    this.permissionReplies.push(input);
    return Promise.resolve(true);
  }

  subscribeEvents(input: {
    signal: AbortSignal;
    directory?: string;
  }): AsyncIterable<SdkEvent> {
    this.subscriptionSignals.push(input.signal);
    return this.eventsFactory(input);
  }
}

export interface TestAppHandle {
  app: Hono<AppBindings>;
  gateway: MockGateway;
  sseHub: SseHub;
  config: ServerConfig;
}

export function createTestApp(options: {
  workspaceRoot: string;
  gateway?: MockGateway;
  sseHeartbeatMs?: number;
  rateLimit?: { windowMs: number; max: number };
  bodyLimitBytes?: number;
  configOverrides?: Partial<ServerConfig>;
}): TestAppHandle {
  const gateway = options.gateway ?? new MockGateway();
  const config = testConfig(options.workspaceRoot, options.configOverrides);
  const logger = createLogger({ level: "error", sink: () => undefined });
  const handle = createApp({
    config,
    gateway,
    logger,
    ...(options.sseHeartbeatMs !== undefined ? { sseHeartbeatMs: options.sseHeartbeatMs } : {}),
    ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
    ...(options.bodyLimitBytes !== undefined ? { bodyLimitBytes: options.bodyLimitBytes } : {}),
  });

  return { app: handle.app, gateway, sseHub: handle.sseHub, config };
}

export async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 2_000,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  while (!predicate(text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for stream output. Received: ${JSON.stringify(text)}`);
    }
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out reading stream. Received: ${JSON.stringify(text)}`));
        }, remaining);
        timer.unref();
      }),
    ]);
    if (result.done) {
      break;
    }
    text += decoder.decode(result.value, { stream: true });
  }

  return text;
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
