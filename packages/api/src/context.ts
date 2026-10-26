import type { Session } from "@matms/auth";
import type { Database } from "@matms/db";
import type { ApplicationRole } from "@matms/db/schema/identity";

export type ApplicationProfile = {
  role: ApplicationRole;
  active: boolean;
  mustChangePassword: boolean;
};

export type AuthenticatedSession = Session & {
  profile: ApplicationProfile;
};

export type Context = {
  session: AuthenticatedSession | null;
  db: Database;
  correlationId: string;
};
