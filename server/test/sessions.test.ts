import { afterAll, describe, expect, it } from "vitest";
import { authHeaders, createTempWorkspace, createTestApp } from "./helpers.js";

const workspace = createTempWorkspace();

afterAll(() => {
  workspace.cleanup();
});

function app(configOverrides?: Parameters<typeof createTestApp>[0]["configOverrides"]) {
  return createTestApp({
    workspaceRoot: workspace.root,
    ...(configOverrides !== undefined ? { configOverrides } : {}),
  });
}

describe("session routes", () => {
  it("creates, lists, reads, and deletes sessions", async () => {
    const handle = app();

    const created = await handle.app.request("/api/v1/sessions", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Phase 1 session" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      session: { id: string; title: string };
    };
    expect(createdBody.session.title).toBe("Phase 1 session");
    expect(handle.gateway.createdSessions).toEqual([{ title: "Phase 1 session" }]);

    const listed = await handle.app.request("/api/v1/sessions", { headers: authHeaders() });
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions).toHaveLength(1);

    const fetched = await handle.app.request(`/api/v1/sessions/${createdBody.session.id}`, {
      headers: authHeaders(),
    });
    expect(fetched.status).toBe(200);

    const deleted = await handle.app.request(`/api/v1/sessions/${createdBody.session.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(handle.gateway.deletedSessions).toEqual([createdBody.session.id]);
  });

  it("rejects malformed session ids", async () => {
    const response = await app().app.request(
      `/api/v1/sessions/${encodeURIComponent("../../etc/passwd")}`,
      { headers: authHeaders() },
    );
    expect([400, 404]).toContain(response.status);
    if (response.status === 400) {
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_SESSION_ID");
    }
  });

  it("prompts with the explicit model", async () => {
    const handle = app();
    const response = await handle.app.request("/api/v1/sessions/ses_1/prompt", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Hello",
        model: { providerID: "deepseek", modelID: "deepseek-chat" },
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, sessionID: "ses_1" });
    expect(handle.gateway.prompts).toEqual([
      {
        sessionID: "ses_1",
        text: "Hello",
        model: { providerID: "deepseek", modelID: "deepseek-chat" },
      },
    ]);
  });

  it("falls back to OPENCODE_MODEL when no model is sent", async () => {
    const handle = app({ opencodeModel: "deepseek/deepseek-reasoner" });
    await handle.app.request("/api/v1/sessions/ses_1/prompt", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });

    expect(handle.gateway.prompts[0]?.model).toEqual({
      providerID: "deepseek",
      modelID: "deepseek-reasoner",
    });
  });

  it("aborts a session", async () => {
    const handle = app();
    const response = await handle.app.request("/api/v1/sessions/ses_1/abort", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aborted: true });
    expect(handle.gateway.abortedSessions).toEqual(["ses_1"]);
  });

  it("replies to a permission request", async () => {
    const handle = app();
    const response = await handle.app.request("/api/v1/sessions/ses_1/permissions/per_1", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ response: "once" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ replied: true });
    expect(handle.gateway.permissionReplies).toEqual([
      {
        sessionID: "ses_1",
        permissionID: "per_1",
        response: "once",
      },
    ]);
  });

  it("validates permission responses", async () => {
    const handle = app();
    const response = await handle.app.request("/api/v1/sessions/ses_1/permissions/per_1", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ response: "maybe" }),
    });
    expect(response.status).toBe(400);
    expect(handle.gateway.permissionReplies).toEqual([]);
  });

  it("returns 404 for unknown sessions from the gateway", async () => {
    const response = await app().app.request("/api/v1/sessions/ses_missing", {
      headers: authHeaders(),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("OPENCODE_NOT_FOUND");
  });
});

describe("meta and health", () => {
  it("exposes sanitized provider information and no keys", async () => {
    const handle = app();
    handle.gateway.providers = [
      {
        id: "deepseek",
        name: "DeepSeek",
        connected: true,
        defaultModel: "deepseek-chat",
        models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
      },
    ];

    const response = await handle.app.request("/api/v1/meta", { headers: authHeaders() });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("apiKey");
    const body = JSON.parse(text) as {
      sdk: { version: string };
      opencode: { mode: string };
      providers: Array<{ id: string }>;
    };
    expect(body.sdk.version).toBe("1.19.6");
    expect(body.opencode.mode).toBe("embedded");
    expect(body.providers[0]?.id).toBe("deepseek");
  });

  it("reports degraded health with 503 when OpenCode is unreachable", async () => {
    const handle = app();
    handle.gateway.healthy = false;
    handle.gateway.healthMessage = "OpenCode is not reachable.";

    const response = await handle.app.request("/health");
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      opencode: { healthy: boolean; message: string };
    };
    expect(body.status).toBe("degraded");
    expect(body.opencode.healthy).toBe(false);
    expect(body.opencode.message).toBe("OpenCode is not reachable.");
  });
});
