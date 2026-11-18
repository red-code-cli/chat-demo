import type { Event } from "@opencode-ai/sdk";
import type { OpencodeMode } from "../config.js";

export type SdkEvent = Event;
export type PermissionResponse = "once" | "always" | "reject";

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  parentID?: string;
  directory: string;
  time: {
    created: number;
    updated: number;
  };
}

export interface ProviderSummary {
  id: string;
  name: string;
  connected: boolean;
  defaultModel?: string;
  models: Array<{
    id: string;
    name: string;
  }>;
}

export interface GatewayHealth {
  mode: OpencodeMode;
  healthy: boolean;
  message?: string;
}

export interface OpencodeGateway {
  readonly mode: OpencodeMode;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<GatewayHealth>;
  listProviders(): Promise<ProviderSummary[]>;
  createSession(input: { title?: string; directory?: string }): Promise<SessionSummary>;
  listSessions(input?: { directory?: string }): Promise<SessionSummary[]>;
  getSession(id: string, input?: { directory?: string }): Promise<SessionSummary>;
  deleteSession(id: string, input?: { directory?: string }): Promise<boolean>;
  promptAsync(input: {
    sessionID: string;
    text: string;
    model?: ModelRef;
    directory?: string;
  }): Promise<void>;
  abortSession(id: string, input?: { directory?: string }): Promise<boolean>;
  replyPermission(input: {
    sessionID: string;
    permissionID: string;
    response: PermissionResponse;
    directory?: string;
  }): Promise<boolean>;
  subscribeEvents(input: {
    signal: AbortSignal;
    directory?: string;
  }): AsyncIterable<SdkEvent>;
}
