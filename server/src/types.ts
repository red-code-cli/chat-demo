import type { HttpBindings } from "@hono/node-server";

export type AppBindings = {
  Bindings: Partial<HttpBindings>;
  Variables: {
    requestId: string;
  };
};
