import { afterAll, describe, expect, it } from "vitest";
import { authHeaders, createTempWorkspace, createTestApp, TEST_ORIGIN, TEST_TOKEN } from "./helpers.js";

const workspace = createTempWorkspace();

afterAll(() => {
  workspace.cleanup();
});

function app() {
  return createTestApp({ workspaceRoot: workspace.root });
}

describe("bearer auth", () => {
  it("rejects requests without a token using the shared error envelope", async () => {
    const response = await app().app.request("/api/v1/sessions");
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBeTruthy();
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    ["wrong token with the same length", "x".repeat(TEST_TOKEN.length)],
    ["short token", "nope"],
    ["empty token", ""],
  ])("rejects a %s", async (_name, token) => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  it("rejects non-bearer authorization schemes", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: { Authorization: `Basic ${Buffer.from("a:b").toString("base64")}` },
    });
    expect(response.status).toBe(401);
  });

  it("accepts the configured token", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: authHeaders(),
    });
    expect(response.status).toBe(200);
  });

  it("leaves /health public", async () => {
    const response = await app().app.request("/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});

describe("security headers and CORS", () => {
  it("sets conservative headers on API responses", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: authHeaders(),
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns CORS headers for an allowed origin", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: { ...authHeaders(), Origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(response.headers.get("access-control-expose-headers")).toContain("X-Request-Id");
  });

  it("answers preflight requests for an allowed origin", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: TEST_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("rejects requests from an origin outside ALLOWED_ORIGINS", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      headers: { ...authHeaders(), Origin: "https://evil.example.com" },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects preflight requests from a disallowed origin", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.status).toBe(403);
  });
});

describe("request guards", () => {
  it("uses the error envelope for unknown routes", async () => {
    const response = await app().app.request("/api/v1/unknown", {
      headers: authHeaders(),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("rejects invalid JSON with INVALID_JSON", async () => {
    const response = await app().app.request("/api/v1/sessions", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("rejects invalid prompt bodies with VALIDATION_ERROR", async () => {
    const response = await app().app.request("/api/v1/sessions/ses_1/prompt", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces the body size limit", async () => {
    const response = await createTestApp({
      workspaceRoot: workspace.root,
      bodyLimitBytes: 128,
    }).app.request("/api/v1/sessions", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(256) }),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rate limits API requests and exposes Retry-After", async () => {
    const handle = createTestApp({
      workspaceRoot: workspace.root,
      rateLimit: { windowMs: 60_000, max: 2 },
    });

    expect(
      (await handle.app.request("/api/v1/sessions", { headers: authHeaders() })).status,
    ).toBe(200);
    expect(
      (await handle.app.request("/api/v1/sessions", { headers: authHeaders() })).status,
    ).toBe(200);

    const limited = await handle.app.request("/api/v1/sessions", { headers: authHeaders() });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await limited.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBe(limited.headers.get("x-request-id"));
  });
});
