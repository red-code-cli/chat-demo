/**
 * Resolve the session id for an OpenCode event.
 *
 * OpenCode uses a single `{ type, properties }` envelope, but the session id
 * lives in a different field per event family. Keeping the lookup here means
 * the SSE route does not need to know every event variant.
 */
export function eventSessionId(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const properties = event.properties;
  if (!isRecord(properties)) {
    return undefined;
  }

  if (typeof properties.sessionID === "string") {
    return properties.sessionID;
  }

  const info = properties.info;
  if (isRecord(info)) {
    if (typeof info.sessionID === "string") {
      return info.sessionID;
    }
    if (typeof info.id === "string" && isSessionInfo(info)) {
      return info.id;
    }
  }

  const part = properties.part;
  if (isRecord(part) && typeof part.sessionID === "string") {
    return part.sessionID;
  }

  return undefined;
}

function isSessionInfo(value: Record<string, unknown>): boolean {
  return typeof value.directory === "string" || typeof value.version === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
