import { createOpencodeClient } from "@opencode-ai/sdk";
import type { ProviderListResponses, Session } from "@opencode-ai/sdk";
import { GatewayError } from "../errors.js";
import type { ProviderSummary, SessionSummary } from "./types.js";

export type SdkClient = ReturnType<typeof createOpencodeClient>;
type ProviderList = ProviderListResponses[200];

export interface SdkClientOptions {
  baseUrl: string;
  directory: string;
  password?: string;
  timeoutMs?: number;
}

export function createSdkClient(options: SdkClientOptions): SdkClient {
  const headers: Record<string, string> = {};
  if (options.password !== undefined) {
    headers.Authorization = basicAuthHeader("opencode", options.password);
  }

  return createOpencodeClient({
    baseUrl: options.baseUrl,
    directory: options.directory,
    headers,
    ...(options.timeoutMs !== undefined && options.timeoutMs > 0
      ? { fetch: createTimeoutFetch(options.timeoutMs) }
      : {}),
  });
}

export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function createTimeoutFetch(timeoutMs: number): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException("OpenCode request timed out", "TimeoutError"));
    }, timeoutMs);
    timer.unref();

    const forwardAbort = (): void => {
      controller.abort(request.signal.reason);
    };
    request.signal.addEventListener("abort", forwardAbort, { once: true });

    try {
      return await fetch(request, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", forwardAbort);
    }
  };
}

export interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export function assertSdkOk(
  result: { error?: unknown; response: Response },
  operation: string,
): void {
  if (result.error === undefined && result.response.ok) {
    return;
  }

  const status = result.response.status;
  if (status === 404) {
    throw new GatewayError("OPENCODE_NOT_FOUND", "OpenCode resource not found.", 404, {
      cause: { operation, status, error: result.error },
    });
  }
  if (status === 401 || status === 403) {
    throw new GatewayError("OPENCODE_AUTH_FAILED", "OpenCode authentication failed.", 502, {
      cause: { operation, status, error: result.error },
    });
  }
  if (status === 400 || status === 422) {
    throw new GatewayError("OPENCODE_BAD_REQUEST", "OpenCode rejected the request.", 400, {
      cause: { operation, status, error: result.error },
    });
  }
  if (status === 429) {
    throw new GatewayError("OPENCODE_RATE_LIMITED", "OpenCode is rate limited.", 502, {
      cause: { operation, status, error: result.error },
    });
  }
  throw new GatewayError("OPENCODE_REQUEST_FAILED", "OpenCode request failed.", 502, {
    cause: { operation, status, error: result.error },
  });
}

export function assertSdkData<T>(result: SdkResult<T>, operation: string): T {
  assertSdkOk(result, operation);
  if (result.data === undefined) {
    throw new GatewayError("OPENCODE_EMPTY_RESPONSE", "OpenCode returned an empty response.", 502, {
      cause: { operation },
    });
  }
  return result.data;
}

export function toGatewayError(error: unknown, operation: string): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new GatewayError("OPENCODE_TIMEOUT", "OpenCode request timed out.", 504, {
      cause: { operation, error },
    });
  }
  return new GatewayError("OPENCODE_UNAVAILABLE", "OpenCode is not reachable.", 502, {
    cause: { operation, error },
  });
}

export function toSessionSummary(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    parentID: session.parentID,
    directory: session.directory,
    time: {
      created: session.time.created,
      updated: session.time.updated,
    },
  };
}

export function toProviderSummaries(data: ProviderList): ProviderSummary[] {
  return [...data.all]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      connected: data.connected.includes(provider.id),
      defaultModel: data.default[provider.id],
      models: Object.values(provider.models)
        .map((model) => ({ id: model.id, name: model.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

