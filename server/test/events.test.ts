import { afterAll, describe, expect, it } from "vitest";
import type { SdkEvent } from "../src/opencode/types.js";
import {
  authHeaders,
  createTempWorkspace,
  createTestApp,
  fakeEvent,
  readUntil,
  waitFor,
} from "./helpers.js";

const workspace = createTempWorkspace();

afterAll(() => {
  workspace.cleanup();
});

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function* waitForAbortEvents(input: {
  signal: AbortSignal;
}): AsyncIterable<SdkEvent> {
  await waitForAbort(input.signal);
}

async function* scriptedEvents(
  input: { signal: AbortSignal },
  events: SdkEvent[],
): AsyncIterable<SdkEvent> {
  for (const event of events) {
    yield event;
  }
  await waitForAbort(input.signal);
}

function eventsRequest(app: ReturnType<typeof createTestApp>, query = "") {
  return app.app.request(`/api/v1/events${query}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
}

describe("SSE events route", () => {
  it("requires a bearer token", async () => {
    const response = await createTestApp({ workspaceRoot: workspace.root }).app.request(
      "/api/v1/events",
    );
    expect(response.status).toBe(401);
  });

  it("rejects malformed session filters", async () => {
    const response = await createTestApp({ workspaceRoot: workspace.root }).app.request(
      "/api/v1/events?session=bad%2Fsession",
      { headers: authHeaders() },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_SESSION_ID");
  });

  it("streams only events for the requested session", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root, sseHeartbeatMs: 0 });
    handle.gateway.eventsFactory = (input) =>
      scriptedEvents(input, [
        fakeEvent("session.created", {
          info: { id: "ses_other", directory: workspace.root, version: "1.19.6" },
        }),
        fakeEvent("message.part.updated", {
          part: { sessionID: "ses_target", type: "text", text: "hello" },
        }),
        fakeEvent("session.idle", { sessionID: "ses_target" }),
      ]);

    const response = await eventsRequest(handle, "?session=ses_target");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const text = await readUntil(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      (chunk) => chunk.includes("session.idle"),
    );

    expect(text).toContain("ses_target");
    expect(text).not.toContain("ses_other");
    await reader?.cancel();
  });

  it("sends heartbeat comments", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root, sseHeartbeatMs: 20 });
    handle.gateway.eventsFactory = waitForAbortEvents;

    const response = await eventsRequest(handle);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const text = await readUntil(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      (chunk) => chunk.includes(": heartbeat"),
      2_000,
    );

    expect(text).toContain(": heartbeat");
    await reader?.cancel();
    await waitFor(() => handle.sseHub.size === 0);
  });

  it("aborts the upstream subscription when the client disconnects", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root, sseHeartbeatMs: 0 });
    let upstreamSignal: AbortSignal | undefined;
    handle.gateway.eventsFactory = (input) => {
      upstreamSignal = input.signal;
      return waitForAbortEvents(input);
    };

    const response = await eventsRequest(handle);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await waitFor(() => upstreamSignal !== undefined);

    await reader?.cancel();
    await waitFor(() => upstreamSignal?.aborted === true);
    await waitFor(() => handle.sseHub.size === 0);
  });

  it("closes upstream subscriptions during shutdown", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root, sseHeartbeatMs: 0 });
    let upstreamSignal: AbortSignal | undefined;
    handle.gateway.eventsFactory = (input) => {
      upstreamSignal = input.signal;
      return waitForAbortEvents(input);
    };

    const response = await eventsRequest(handle);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await waitFor(() => upstreamSignal !== undefined);

    handle.sseHub.closeAll();
    await waitFor(() => upstreamSignal?.aborted === true);
    await waitFor(() => handle.sseHub.size === 0);

    const rest = await readUntil(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      () => false,
      500,
    ).catch(() => "");
    expect(rest).not.toContain("heartbeat");
    await reader?.cancel();
  });

  it("emits an SSE error frame when the upstream stream fails", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root, sseHeartbeatMs: 0 });
    handle.gateway.eventsFactory = async function* failingEvents(): AsyncIterable<SdkEvent> {
      throw new Error("upstream exploded");
    };

    const response = await eventsRequest(handle);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const text = await readUntil(
      reader as ReadableStreamDefaultReader<Uint8Array>,
      (chunk) => chunk.includes("OPENCODE_EVENT_STREAM_FAILED"),
    );

    expect(text).toContain("event: error");
    expect(text).not.toContain("upstream exploded");
    await reader?.cancel();
    await waitFor(() => handle.sseHub.size === 0);
  });
});
