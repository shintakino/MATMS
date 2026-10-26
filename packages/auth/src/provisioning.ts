import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, count, eq, sql } from "drizzle-orm";

import { writeAuditEntry } from "@matms/db";
import type { AuditTransaction, Database } from "@matms/db";
import { account, session, user } from "@matms/db/schema/auth";
import type { ApplicationRole } from "@matms/db/schema/identity";
import { userProfiles } from "@matms/db/schema/identity";

const ACTIVE_ADMIN_LOCK = "matms:active-admins";

export class IdentityServiceError extends Error {
  public constructor(
    public readonly code: "BOOTSTRAP_COMPLETE" | "DUPLICATE_EMAIL" | "LAST_ACTIVE_ADMIN" | "USER_NOT_FOUND" | "INVALID_PASSWORD",
    message: string,
  ) {
    super(message);
    this.name = "IdentityServiceError";
  }
}

export type ProvisionAccountInput = {
  name: string;
  email: string;
  password: string;
  role: ApplicationRole;
  actorId: string | null;
  correlationId: string;
  mustChangePassword?: boolean;
};

type BootstrapAdminInput = Omit<ProvisionAccountInput, "actorId" | "role">;

type AccountSummary = {
  id: string;
  name: string;
  email: string;
  role: ApplicationRole;
  active: boolean;
  mustChangePassword: boolean;
};

async function lockActiveAdminChanges(tx: AuditTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ACTIVE_ADMIN_LOCK}))`);
}

async function activeAdminCount(tx: AuditTransaction) {
  const [result] = await tx
    .select({ value: count() })
    .from(userProfiles)
    .where(and(eq(userProfiles.role, "admin"), eq(userProfiles.active, true)));

  return Number(result?.value ?? 0);
}

function asAccountSummary(input: {
  id: string;
  name: string;
  email: string;
  role: ApplicationRole;
  active: boolean;
  mustChangePassword: boolean;
}): AccountSummary {
  return input;
}

async function createAccountInTransaction(tx: AuditTransaction, input: ProvisionAccountInput, passwordHash: string) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await tx.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1);

  if (existing.length) {
    throw new IdentityServiceError("DUPLICATE_EMAIL", "An account with that email already exists.");
  }

  const now = new Date();
  const userId = crypto.randomUUID();

  await tx.insert(user).values({
    id: userId,
    name: input.name.trim(),
    email: normalizedEmail,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(userProfiles).values({
    userId,
    role: input.role,
    active: true,
    mustChangePassword: input.mustChangePassword ?? true,
    createdAt: now,
    updatedAt: now,
  });

  await writeAuditEntry(tx, {
    actorId: input.actorId,
    action: input.actorId ? "identity.account_provisioned" : "identity.first_admin_bootstrapped",
    targetType: "user",
    targetId: userId,
    after: {
      email: normalizedEmail,
      role: input.role,
      active: true,
      mustChangePassword: input.mustChangePassword ?? true,
    },
    correlationId: input.correlationId,
  });

  return asAccountSummary({
    id: userId,
    name: input.name.trim(),
    email: normalizedEmail,
    role: input.role,
    active: true,
    mustChangePassword: input.mustChangePassword ?? true,
  });
}

/** Creates the only unauthenticated account operation and refuses every later attempt. */
export async function bootstrapFirstAdmin(db: Database, input: BootstrapAdminInput): Promise<AccountSummary> {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    await lockActiveAdminChanges(tx);
    if ((await activeAdminCount(tx)) > 0) {
      throw new IdentityServiceError("BOOTSTRAP_COMPLETE", "The first Administrator has already been created.");
    }

    return createAccountInTransaction(
      tx,
      { ...input, actorId: null, role: "admin", mustChangePassword: input.mustChangePassword ?? true },
      passwordHash,
    );
  });
}

export async function provisionAccount(db: Database, input: ProvisionAccountInput): Promise<AccountSummary> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction((tx) => createAccountInTransaction(tx, input, passwordHash));
}

async function getProfileForUpdate(tx: AuditTransaction, userId: string) {
  const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  if (!profile) {
    throw new IdentityServiceError("USER_NOT_FOUND", "The requested account is unavailable.");
  }
  return profile;
}

async function ensureAdminRemains(tx: AuditTransaction, profile: { role: ApplicationRole; active: boolean }, next: { role: ApplicationRole; active: boolean }) {
  if (profile.role !== "admin" || !profile.active || (next.role === "admin" && next.active)) {
    return;
  }

  if ((await activeAdminCount(tx)) <= 1) {
    throw new IdentityServiceError("LAST_ACTIVE_ADMIN", "At least one active Administrator is required.");
  }
}

export async function changeAccountRole(
  db: Database,
  input: { actorId: string; userId: string; role: ApplicationRole; correlationId: string },
) {
  return db.transaction(async (tx) => {
    await lockActiveAdminChanges(tx);
    const profile = await getProfileForUpdate(tx, input.userId);
    await ensureAdminRemains(tx, profile, { role: input.role, active: profile.active });

    await tx.update(userProfiles).set({ role: input.role, updatedAt: new Date() }).where(eq(userProfiles.userId, input.userId));
    await writeAuditEntry(tx, {
      actorId: input.actorId,
      action: "identity.role_changed",
      targetType: "user",
      targetId: input.userId,
      before: { role: profile.role },
      after: { role: input.role },
      correlationId: input.correlationId,
    });
  });
}

export async function setAccountActive(
  db: Database,
  input: { actorId: string; userId: string; active: boolean; correlationId: string },
) {
  return db.transaction(async (tx) => {
    await lockActiveAdminChanges(tx);
    const profile = await getProfileForUpdate(tx, input.userId);
    await ensureAdminRemains(tx, profile, { role: profile.role, active: input.active });

    await tx.update(userProfiles).set({ active: input.active, updatedAt: new Date() }).where(eq(userProfiles.userId, input.userId));
    if (!input.active) {
      await tx.delete(session).where(eq(session.userId, input.userId));
    }
    await writeAuditEntry(tx, {
      actorId: input.actorId,
      action: input.active ? "identity.account_activated" : "identity.account_deactivated",
      targetType: "user",
      targetId: input.userId,
      before: { active: profile.active },
      after: { active: input.active },
      correlationId: input.correlationId,
    });
  });
}

export async function resetAccountPassword(
  db: Database,
  input: { actorId: string; userId: string; password: string; correlationId: string },
) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await getProfileForUpdate(tx, input.userId);
    const updated = await tx
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, input.userId), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (!updated.length) {
      throw new IdentityServiceError("USER_NOT_FOUND", "The requested account is unavailable.");
    }

    await tx
      .update(userProfiles)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(userProfiles.userId, input.userId));
    await tx.delete(session).where(eq(session.userId, input.userId));
    await writeAuditEntry(tx, {
      actorId: input.actorId,
      action: "identity.password_reset_required",
      targetType: "user",
      targetId: input.userId,
      after: { mustChangePassword: true },
      correlationId: input.correlationId,
    });
  });
}

export async function changeOwnPassword(
  db: Database,
  input: { userId: string; currentPassword: string; newPassword: string; correlationId: string },
) {
  const [credential] = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, input.userId), eq(account.providerId, "credential")))
    .limit(1);

  if (!credential?.password || !(await verifyPassword({ hash: credential.password, password: input.currentPassword }))) {
    throw new IdentityServiceError("INVALID_PASSWORD", "The current password could not be verified.");
  }

  const passwordHash = await hashPassword(input.newPassword);
  return db.transaction(async (tx) => {
    await tx
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, input.userId), eq(account.providerId, "credential")));
    await tx
      .update(userProfiles)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(userProfiles.userId, input.userId));
    await writeAuditEntry(tx, {
      actorId: input.userId,
      action: "identity.password_changed",
      targetType: "user",
      targetId: input.userId,
      after: { mustChangePassword: false },
      correlationId: input.correlationId,
    });
  });
}

export async function listAccounts(db: Database): Promise<AccountSummary[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: userProfiles.role,
      active: userProfiles.active,
      mustChangePassword: userProfiles.mustChangePassword,
    })
    .from(userProfiles)
    .innerJoin(user, eq(userProfiles.userId, user.id))
    .orderBy(user.name);

  return rows.map(asAccountSummary);
}
