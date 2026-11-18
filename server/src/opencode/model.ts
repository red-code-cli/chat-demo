import type { ModelRef } from "./types.js";

export function parseModelRef(value: string | undefined): ModelRef | undefined {
  if (value === undefined) {
    return undefined;
  }

  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    return undefined;
  }

  const providerID = value.slice(0, separator).trim();
  const modelID = value.slice(separator + 1).trim();
  if (!providerID || !modelID || /\s/.test(providerID) || /\s/.test(modelID)) {
    return undefined;
  }

  return { providerID, modelID };
}
