import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  version?: string;
  dependencies?: Record<string, string>;
}

function readManifest(): PackageManifest {
  try {
    const manifestPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  } catch {
    return {};
  }
}

const manifest = readManifest();

export const SERVER_VERSION = manifest.version ?? "0.0.0";
export const SDK_VERSION = manifest.dependencies?.["@opencode-ai/sdk"] ?? "unknown";
export const OPENCODE_CLI_VERSION = manifest.dependencies?.["opencode-ai"] ?? "unknown";
