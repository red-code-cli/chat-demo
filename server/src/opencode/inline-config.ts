import type { Config } from "@opencode-ai/sdk";
import type { LogLevelName } from "../config.js";
import { parseModelRef } from "./model.js";

export interface InlineConfigInput {
  model?: string;
  providerApiKey?: string;
  logLevel?: LogLevelName;
}

const SDK_LOG_LEVEL: Record<LogLevelName, NonNullable<Config["logLevel"]>> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

export function buildInlineConfig(input: InlineConfigInput): Config {
  const config: Config = {
    permission: {
      edit: "allow",
      bash: "allow",
    },
    ...(input.logLevel !== undefined ? { logLevel: SDK_LOG_LEVEL[input.logLevel] } : {}),
  };

  if (input.model !== undefined) {
    config.model = input.model;
  }

  const model = parseModelRef(input.model);
  if (input.providerApiKey !== undefined && model !== undefined) {
    config.provider = {
      [model.providerID]: {
        options: {
          apiKey: input.providerApiKey,
        },
      },
    };
  }

  return config;
}
