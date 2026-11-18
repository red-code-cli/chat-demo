import type { OpencodeMode, ServerConfig } from "../config.js";
import { GatewayError } from "../errors.js";
import type { Logger } from "../logger.js";
import {
  assertSdkData,
  assertSdkOk,
  createSdkClient,
  toGatewayError,
  toProviderSummaries,
  toSessionSummary,
  type SdkClient,
} from "./sdk.js";
import type {
  ModelRef,
  OpencodeGateway,
  PermissionResponse,
  ProviderSummary,
  SessionSummary,
  SdkEvent,
} from "./types.js";

export abstract class SdkOpencodeGateway implements OpencodeGateway {
  abstract readonly mode: OpencodeMode;

  protected client?: SdkClient;
  protected eventsClient?: SdkClient;

  protected constructor(
    protected readonly config: ServerConfig,
    protected readonly logger: Logger,
  ) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract health(): Promise<Awaited<ReturnType<OpencodeGateway["health"]>>>;

  protected setClients(baseUrl: string, password: string | undefined): void {
    this.client = createSdkClient({
      baseUrl,
      password,
      directory: this.config.workspaceRoot,
      timeoutMs: 30_000,
    });
    this.eventsClient = createSdkClient({
      baseUrl,
      password,
      directory: this.config.workspaceRoot,
      timeoutMs: 0,
    });
  }

  protected clearClients(): void {
    this.client = undefined;
    this.eventsClient = undefined;
  }

  protected get sdk(): SdkClient {
    if (this.client === undefined) {
      throw new GatewayError("OPENCODE_NOT_READY", "OpenCode is not ready.", 503);
    }
    return this.client;
  }

  protected get eventSdk(): SdkClient {
    return this.eventsClient ?? this.sdk;
  }

  async listProviders(): Promise<ProviderSummary[]> {
    try {
      const result = await this.sdk.provider.list();
      return toProviderSummaries(assertSdkData(result, "list providers"));
    } catch (error) {
      throw toGatewayError(error, "list providers");
    }
  }

  async createSession(input: { title?: string; directory?: string }): Promise<SessionSummary> {
    try {
      const result = await this.sdk.session.create({
        body: input.title !== undefined ? { title: input.title } : undefined,
        query: input.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return toSessionSummary(assertSdkData(result, "create session"));
    } catch (error) {
      throw toGatewayError(error, "create session");
    }
  }

  async listSessions(input?: { directory?: string }): Promise<SessionSummary[]> {
    try {
      const result = await this.sdk.session.list({
        query: input?.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return assertSdkData(result, "list sessions").map(toSessionSummary);
    } catch (error) {
      throw toGatewayError(error, "list sessions");
    }
  }

  async getSession(id: string, input?: { directory?: string }): Promise<SessionSummary> {
    try {
      const result = await this.sdk.session.get({
        path: { id },
        query: input?.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return toSessionSummary(assertSdkData(result, "get session"));
    } catch (error) {
      throw toGatewayError(error, "get session");
    }
  }

  async deleteSession(id: string, input?: { directory?: string }): Promise<boolean> {
    try {
      const result = await this.sdk.session.delete({
        path: { id },
        query: input?.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return assertSdkData(result, "delete session") === true;
    } catch (error) {
      throw toGatewayError(error, "delete session");
    }
  }

  async promptAsync(input: {
    sessionID: string;
    text: string;
    model?: ModelRef;
    directory?: string;
  }): Promise<void> {
    try {
      const result = await this.sdk.session.promptAsync({
        path: { id: input.sessionID },
        body: {
          parts: [{ type: "text", text: input.text }],
          ...(input.model !== undefined ? { model: input.model } : {}),
        },
        query: input.directory !== undefined ? { directory: input.directory } : undefined,
      });
      assertSdkOk(result, "prompt session");
    } catch (error) {
      throw toGatewayError(error, "prompt session");
    }
  }

  async abortSession(id: string, input?: { directory?: string }): Promise<boolean> {
    try {
      const result = await this.sdk.session.abort({
        path: { id },
        query: input?.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return assertSdkData(result, "abort session") === true;
    } catch (error) {
      throw toGatewayError(error, "abort session");
    }
  }

  async replyPermission(input: {
    sessionID: string;
    permissionID: string;
    response: PermissionResponse;
    directory?: string;
  }): Promise<boolean> {
    try {
      const result = await this.sdk.postSessionIdPermissionsPermissionId({
        path: { id: input.sessionID, permissionID: input.permissionID },
        body: { response: input.response },
        query: input.directory !== undefined ? { directory: input.directory } : undefined,
      });
      return assertSdkData(result, "reply to permission") === true;
    } catch (error) {
      throw toGatewayError(error, "reply to permission");
    }
  }

  async *subscribeEvents(input: {
    signal: AbortSignal;
    directory?: string;
  }): AsyncIterable<SdkEvent> {
    try {
      const result = await this.eventSdk.event.subscribe({
        signal: input.signal,
        query: input.directory !== undefined ? { directory: input.directory } : undefined,
        sseMaxRetryAttempts: 1,
      });
      try {
        yield* result.stream;
      } finally {
        try {
          await result.stream.return(undefined);
        } catch {
          // The stream is already closed or aborted.
        }
      }
    } catch (error) {
      throw toGatewayError(error, "subscribe to events");
    }
  }
}
