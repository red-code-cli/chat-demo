import { realpathSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { createWorkspaceResolver } from "../src/workspace.js";
import {
  authHeaders,
  createSymlinkEscape,
  createTempWorkspace,
  createTestApp,
} from "./helpers.js";

const workspace = createTempWorkspace();

afterAll(() => {
  workspace.cleanup();
});

describe("workspace resolver", () => {
  const resolve = createWorkspaceResolver(workspace.root);

  it("returns undefined when no directory is requested", async () => {
    expect(await resolve(undefined)).toBeUndefined();
    expect(await resolve("   ")).toBeUndefined();
  });

  it("accepts the root, relative folders, and absolute folders inside the root", async () => {
    expect(await resolve(".")).toBe(realpathSync(workspace.root));
    expect(await resolve("project")).toBe(realpathSync(workspace.project));
    expect(await resolve(workspace.project)).toBe(realpathSync(workspace.project));
  });

  it.each([
    "..",
    "../",
    "project/../../",
    "/etc",
    path.join(workspace.root, ".."),
    "missing-folder",
    "outside.txt",
    "project/README.md",
  ])("rejects %s", async (input) => {
    await expect(resolve(input)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects symlinks that escape the workspace", async () => {
    createSymlinkEscape(workspace);
    await expect(resolve("escape")).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
      status: 400,
    });
  });

  it("rejects oversized inputs", async () => {
    await expect(resolve("a".repeat(5000))).rejects.toMatchObject({
      code: "INVALID_DIRECTORY",
    });
  });
});

describe("directory query guard", () => {
  it("passes a valid directory to the gateway", async () => {
    const handle = createTestApp({ workspaceRoot: workspace.root });
    const response = await handle.app.request("/api/v1/sessions?directory=project", {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(handle.gateway.listDirectories).toEqual([realpathSync(workspace.project)]);
  });

  it.each(["..", "../etc", "/etc", "project/../.."])(
    "rejects traversal query %s with the error envelope",
    async (directory) => {
      const handle = createTestApp({ workspaceRoot: workspace.root });
      const response = await handle.app.request(
        `/api/v1/sessions?directory=${encodeURIComponent(directory)}`,
        { headers: authHeaders() },
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(body.error.code).toBe("INVALID_DIRECTORY");
      expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
      expect(handle.gateway.listDirectories).toEqual([]);
    },
  );
});
