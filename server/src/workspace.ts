import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.js";

export type DirectoryResolver = (input?: string) => Promise<string | undefined>;

const MAX_DIRECTORY_LENGTH = 4096;

export function createWorkspaceResolver(workspaceRoot: string): DirectoryResolver {
  let rootRealPromise: Promise<string> | undefined;
  const getRoot = (): Promise<string> => {
    rootRealPromise ??= realpath(workspaceRoot);
    return rootRealPromise;
  };

  return async (input?: string): Promise<string | undefined> => {
    if (input === undefined || input.trim() === "") {
      return undefined;
    }
    if (input.length > MAX_DIRECTORY_LENGTH) {
      throw invalidDirectory();
    }

    const root = await getRoot();
    const candidate = path.resolve(root, input);

    let candidateReal: string;
    try {
      candidateReal = await realpath(candidate);
    } catch {
      throw invalidDirectory();
    }

    const relative = path.relative(root, candidateReal);
    if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
      throw invalidDirectory();
    }

    try {
      if (!(await stat(candidateReal)).isDirectory()) {
        throw invalidDirectory();
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw invalidDirectory();
    }

    return candidateReal;
  };
}

function invalidDirectory(): AppError {
  return new AppError(
    "INVALID_DIRECTORY",
    "Directory must be an existing folder inside WORKSPACE_ROOT.",
    400,
  );
}
