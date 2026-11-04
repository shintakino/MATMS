import type { Database } from "@matms/db";
import { boxes } from "@matms/db/schema/archive";
import { eq } from "drizzle-orm";

import { ArchiveServiceError, getBox, listBoxes, normalizeCode } from "./archive-service";
import type { ArchiveActor } from "./archive-service";

/** Print data is deliberately limited to the fields permitted on a label. */
export async function listLabelBoxes(db: Database, actor: ArchiveActor) {
  if (actor.role === "viewer") throw new ArchiveServiceError("FORBIDDEN", "This action is unavailable.");
  return (await listBoxes(db, actor)).map(({ id, code, categoryName, locationLabel }) => ({ id, code, categoryName, locationLabel }));
}

export async function lookupBoxCode(db: Database, actor: ArchiveActor, code: string) {
  let normalized: string;
  try { normalized = normalizeCode(code); } catch { throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable."); }
  const [row] = await db.select({ id: boxes.id }).from(boxes).where(eq(boxes.normalizedCode, normalized)).limit(1);
  if (!row) throw new ArchiveServiceError("UNAVAILABLE", "This record is unavailable.");
  await getBox(db, actor, row.id);
  return { id: row.id };
}
