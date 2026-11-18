import { describe, expect, it } from "vitest";
import { GatewayError } from "../src/errors.js";
import { eventSessionId } from "../src/opencode/events.js";
import { buildInlineConfig } from "../src/opencode/inline-config.js";
import { parseModelRef } from "../src/opencode/model.js";
import { assertSdkOk } from "../src/opencode/sdk.js";

describe("inline OpenCode config", () => {
  it("always keeps edit and bash permissions on ask", () => {
    const config = buildInlineConfig({});
    expect(config.permission).toEqual({ edit: "ask", bash: "ask" });
  });

  it("maps the model, provider key, and log level without exposing them elsewhere", () => {
    const config = buildInlineConfig({
      model: "deepseek/deepseek-chat",
      providerApiKey: "sk-test",
      logLevel: "warn",
    });

    expect(config.model).toBe("deepseek/deepseek-chat");
    expect(config.logLevel).toBe("WARN");
    expect(config.provider).toEqual({
      deepseek: { options: { apiKey: "sk-test" } },
    });
  });

  it("keeps permissions on ask even with a provider key", () => {
    const config = buildInlineConfig({
      model: "deepseek/deepseek-chat",
      providerApiKey: "sk-test",
    });
    expect(config.permission).toEqual({ edit: "ask", bash: "ask" });
  });
});

describe("model refs", () => {
  it("parses provider/model and keeps the rest of the model id", () => {
    expect(parseModelRef("deepseek/deepseek-chat")).toEqual({
      providerID: "deepseek",
      modelID: "deepseek-chat",
    });
    expect(parseModelRef("openrouter/vendor/model")).toEqual({
      providerID: "openrouter",
      modelID: "vendor/model",
    });
  });

  it("rejects malformed refs", () => {
    expect(parseModelRef(undefined)).toBeUndefined();
    expect(parseModelRef("")).toBeUndefined();
    expect(parseModelRef("deepseek")).toBeUndefined();
    expect(parseModelRef("/model")).toBeUndefined();
    expect(parseModelRef("provider/")).toBeUndefined();
    expect(parseModelRef("pro vider/model")).toBeUndefined();
  });
});

describe("event session extraction", () => {
  it("handles every V1 event family", () => {
    expect(eventSessionId({ type: "session.idle", properties: { sessionID: "ses_a" } })).toBe(
      "ses_a",
    );
    expect(
      eventSessionId({
        type: "message.updated",
        properties: { info: { sessionID: "ses_b" } },
      }),
    ).toBe("ses_b");
    expect(
      eventSessionId({
        type: "session.created",
        properties: { info: { id: "ses_c", directory: "/tmp", version: "1.19.6" } },
      }),
    ).toBe("ses_c");
    expect(
      eventSessionId({
        type: "message.part.updated",
        properties: { part: { sessionID: "ses_d" } },
      }),
    ).toBe("ses_d");
  });

  it("returns undefined for global or malformed events", () => {
    expect(eventSessionId({ type: "server.connected", properties: {} })).toBeUndefined();
    expect(eventSessionId({ type: "server.connected" })).toBeUndefined();
    expect(eventSessionId(null)).toBeUndefined();
    expect(
      eventSessionId({
        type: "session.created",
        properties: { info: { id: "ses_c" } },
      }),
    ).toBeUndefined();
  });
});

describe("SDK error mapping", () => {
  const response = (status: number): Response => new Response(null, { status });

  it("accepts successful results", () => {
    expect(() => assertSdkOk({ response: response(200) }, "test")).not.toThrow();
  });

  it.each([
    [404, 404, "OPENCODE_NOT_FOUND"],
    [401, 502, "OPENCODE_AUTH_FAILED"],
    [403, 502, "OPENCODE_AUTH_FAILED"],
    [400, 400, "OPENCODE_BAD_REQUEST"],
    [422, 400, "OPENCODE_BAD_REQUEST"],
    [429, 502, "OPENCODE_RATE_LIMITED"],
    [500, 502, "OPENCODE_REQUEST_FAILED"],
  ])("maps HTTP %i to %s (%s)", (status, expectedStatus, expectedCode) => {
    try {
      assertSdkOk({ response: response(status), error: { message: "provider detail" } }, "test");
      throw new Error("expected assertSdkOk to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).status).toBe(expectedStatus);
      expect((error as GatewayError).code).toBe(expectedCode);
      expect((error as GatewayError).message).not.toContain("provider detail");
    }
  });
});
