import {
  IdentityServiceError,
  changeAccountRole,
  changeOwnPassword,
  listAccounts,
  provisionAccount,
  resetAccountPassword,
  setAccountActive,
} from "@matms/auth/provisioning";
import type { ApplicationRole } from "@matms/db/schema/identity";
import { z } from "zod";

import { authenticatedProcedure, protectedProcedure } from "../index";
import { MatmsError } from "../errors";

const roleSchema = z.enum(["admin", "staff", "viewer"]);
const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128);

function requireAdministrator(role: ApplicationRole) {
  if (role !== "admin") {
    throw new MatmsError("FORBIDDEN", "This action is unavailable.").toORPCError();
  }
}

function rethrowIdentityError(error: unknown): never {
  if (error instanceof IdentityServiceError) {
    if (error.code === "USER_NOT_FOUND") {
      throw new MatmsError("NOT_FOUND", "This account is unavailable.").toORPCError();
    }
    if (error.code === "INVALID_PASSWORD") {
      throw new MatmsError("VALIDATION_ERROR", "The current password is incorrect.").toORPCError();
    }
    throw new MatmsError("CONFLICT", error.message).toORPCError();
  }
  throw error;
}

export const identityRouter = {
  me: authenticatedProcedure.handler(({ context }) => ({
    id: context.session!.user.id,
    name: context.session!.user.name,
    email: context.session!.user.email,
    role: context.session!.profile.role,
    mustChangePassword: context.session!.profile.mustChangePassword,
  })),

  changeOwnPassword: authenticatedProcedure
    .input(z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }))
    .handler(async ({ context, input }) => {
      try {
        await changeOwnPassword(context.db, {
          userId: context.session!.user.id,
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          correlationId: context.correlationId,
        });
        return { changed: true };
      } catch (error) {
        return rethrowIdentityError(error);
      }
    }),

  admin: {
    listUsers: protectedProcedure.handler(async ({ context }) => {
      requireAdministrator(context.session!.profile.role);
      return listAccounts(context.db);
    }),

    provisionUser: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(120),
          email: z.email().trim(),
          password: passwordSchema,
          role: roleSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        requireAdministrator(context.session!.profile.role);
        try {
          return await provisionAccount(context.db, {
            ...input,
            actorId: context.session!.user.id,
            correlationId: context.correlationId,
          });
        } catch (error) {
          return rethrowIdentityError(error);
        }
      }),

    changeRole: protectedProcedure
      .input(z.object({ userId: z.string().uuid(), role: roleSchema }))
      .handler(async ({ context, input }) => {
        requireAdministrator(context.session!.profile.role);
        try {
          await changeAccountRole(context.db, {
            actorId: context.session!.user.id,
            userId: input.userId,
            role: input.role,
            correlationId: context.correlationId,
          });
          return { changed: true };
        } catch (error) {
          return rethrowIdentityError(error);
        }
      }),

    setActive: protectedProcedure
      .input(z.object({ userId: z.string().uuid(), active: z.boolean() }))
      .handler(async ({ context, input }) => {
        requireAdministrator(context.session!.profile.role);
        try {
          await setAccountActive(context.db, {
            actorId: context.session!.user.id,
            userId: input.userId,
            active: input.active,
            correlationId: context.correlationId,
          });
          return { changed: true };
        } catch (error) {
          return rethrowIdentityError(error);
        }
      }),

    resetPassword: protectedProcedure
      .input(z.object({ userId: z.string().uuid(), password: passwordSchema }))
      .handler(async ({ context, input }) => {
        requireAdministrator(context.session!.profile.role);
        try {
          await resetAccountPassword(context.db, {
            actorId: context.session!.user.id,
            userId: input.userId,
            password: input.password,
            correlationId: context.correlationId,
          });
          return { reset: true };
        } catch (error) {
          return rethrowIdentityError(error);
        }
      }),
  },
};
