import { os } from "@orpc/server";

import type { Context } from "./context";
import { MatmsError } from "./errors";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireActiveAccount = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new MatmsError("UNAUTHENTICATED", "Authentication is required.").toORPCError();
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

/** Active account required; permits the self-service password-change route. */
export const authenticatedProcedure = publicProcedure.use(requireActiveAccount);
/** Active account with a non-temporary password required for business operations. */
export const protectedProcedure = publicProcedure.use(
  o.middleware(async ({ context, next }) => {
    if (!context.session?.user) {
      throw new MatmsError("UNAUTHENTICATED", "Authentication is required.").toORPCError();
    }
    if (context.session.profile.mustChangePassword) {
      throw new MatmsError("FORBIDDEN", "A password change is required before continuing.").toORPCError();
    }
    return next({ context: { session: context.session } });
  }),
);
