import { createAuth } from "@matms/auth";
import { createDb } from "@matms/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
