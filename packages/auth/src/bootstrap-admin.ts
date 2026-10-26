import { createDb } from "@matms/db";
import { z } from "zod";

import { bootstrapFirstAdmin } from "./provisioning";

const bootstrapEnvironment = z.object({
  DATABASE_URL: z.string().min(1),
  INITIAL_ADMIN_NAME: z.string().trim().min(2).max(120),
  INITIAL_ADMIN_EMAIL: z.email().trim(),
  INITIAL_ADMIN_PASSWORD: z.string().min(12).max(128),
});

async function main() {
  const environment = bootstrapEnvironment.parse(process.env);
  const administrator = await bootstrapFirstAdmin(createDb(environment), {
    name: environment.INITIAL_ADMIN_NAME,
    email: environment.INITIAL_ADMIN_EMAIL,
    password: environment.INITIAL_ADMIN_PASSWORD,
    correlationId: crypto.randomUUID(),
    // A bootstrap secret is operator-supplied rather than an issued temporary password.
    mustChangePassword: false,
  });

  console.info(`First Administrator provisioned: ${administrator.email} (${administrator.id})`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unable to bootstrap the first Administrator.");
  process.exitCode = 1;
});
