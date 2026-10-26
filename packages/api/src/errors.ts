import { ORPCError } from "@orpc/server";

export const safeErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INSUFFICIENT_STOCK",
  "ACTIVE_LOAN",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type SafeErrorCode = (typeof safeErrorCodes)[number];

export class MatmsError extends Error {
  public readonly code: SafeErrorCode;

  public constructor(code: SafeErrorCode, message: string) {
    super(message);
    this.name = "MatmsError";
    this.code = code;
  }

  public toORPCError() {
    const status = this.code === "UNAUTHENTICATED" ? "UNAUTHORIZED" : "BAD_REQUEST";
    return new ORPCError(status, { message: this.message, data: { code: this.code } });
  }
}
