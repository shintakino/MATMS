import type { Context as HonoContext } from "hono";
import { db, getAuth } from "./services";
import { sessionContext } from "./session-context";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  return sessionContext(context, { db, ...await getAuth() });
}

export type Context = Awaited<ReturnType<typeof createContext>>;
