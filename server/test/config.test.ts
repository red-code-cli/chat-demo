import { afterAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseAllowedOrigins } from "../src/config.js";
import { TEST_ORIGIN, TEST_TOKEN, createTempWorkspace } from "./helpers.js";

const workspace = createTempWorkspace();

afterAll(() => {
  workspace.cleanup();
});

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    APP_AUTH_TOKEN: TEST_TOKEN,
    ALLOWED_ORIGINS: TEST_ORIGIN,
    WORKSPACE_ROOT: workspace.root,
    ...overrides,
  };
}

describe("parseAllowedOrigins", () => {
  it("normalizes, trims, and de-duplicates origins", () => {
    expect(parseAllowedOrigins(" https://a.example.com/ , https://a.example.com,http://localhost:3000 ")).toEqual([
      "https://a.example.com",
      "http://localhost:3000",
    ]);
  });

  it("rejects wildcard and path origins", () => {
    expect(() => parseAllowedOrigins("*")).toThrow(ConfigError);
    expect(() => parseAllowedOrigins("https://example.com/app")).toThrow(ConfigError);
  });

  it("rejects empty lists", () => {
    expect(() => parseAllowedOrigins(" , ")).toThrow(ConfigError);
  });
});

describe("loadConfig", () => {
  it("returns defaults for optional values", () => {
    const config = loadConfig(baseEnv());
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
    expect(config.opencodeMode).toBe("embedded");
    expect(config.logLevel).toBe("info");
    expect(config.trustProxy).toBe(false);
    expect(config.allowedOrigins).toEqual([TEST_ORIGIN]);
    expect(config.workspaceRoot).toBe(workspace.root);
    expect(config.opencodeDataDir).toMatch(/\.data[/\\]opencode$/);
  });

  it("collects every missing or invalid required value", () => {
    try {
      loadConfig({ PORT: "not-a-port", APP_AUTH_TOKEN: "short" });
      throw new Error("expected loadConfig to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.join("\n");
      expect(issues).toContain("PORT");
      expect(issues).toContain("APP_AUTH_TOKEN");
      expect(issues).toContain("ALLOWED_ORIGINS");
      expect(issues).toContain("WORKSPACE_ROOT");
    }
  });

  it("requires an existing workspace directory", () => {
    expect(() =>
      loadConfig(baseEnv({ WORKSPACE_ROOT: `${workspace.root}/does-not-exist` })),
    ).toThrow(/WORKSPACE_ROOT: .* does not exist/);
  });

  it("requires OPENCODE_BASE_URL in remote mode and forbids it in embedded mode", () => {
    expect(() => loadConfig(baseEnv({ OPENCODE_MODE: "remote" }))).toThrow(
      /OPENCODE_BASE_URL: required/,
    );
    expect(() =>
      loadConfig(
        baseEnv({
          OPENCODE_MODE: "embedded",
          OPENCODE_BASE_URL: "http://127.0.0.1:4096",
        }),
      ),
    ).toThrow(/OPENCODE_BASE_URL: only valid/);

    const config = loadConfig(
      baseEnv({ OPENCODE_MODE: "remote", OPENCODE_BASE_URL: "http://127.0.0.1:4096/" }),
    );
    expect(config.opencodeMode).toBe("remote");
    expect(config.opencodeBaseUrl).toBe("http://127.0.0.1:4096");
  });

  it("validates model and provider key pairs", () => {
    expect(() => loadConfig(baseEnv({ OPENCODE_MODEL: "no-slash" }))).toThrow(
      /OPENCODE_MODEL/,
    );
    expect(() => loadConfig(baseEnv({ OPENCODE_PROVIDER_API_KEY: "key" }))).toThrow(
      /OPENCODE_MODEL: required/,
    );

    const config = loadConfig(
      baseEnv({
        OPENCODE_MODEL: "deepseek/deepseek-chat",
        OPENCODE_PROVIDER_API_KEY: "test-key",
      }),
    );
    expect(config.opencodeModel).toBe("deepseek/deepseek-chat");
    expect(config.opencodeProviderApiKey).toBe("test-key");
  });

  it("rejects invalid log levels, booleans, and modes", () => {
    expect(() => loadConfig(baseEnv({ LOG_LEVEL: "trace" }))).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig(baseEnv({ TRUST_PROXY: "yes" }))).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig(baseEnv({ OPENCODE_MODE: "cloud" }))).toThrow(/OPENCODE_MODE/);
  });
});
