import { createDb } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { boxes, categories, documents, folders, shelfLocations } from "@matms/db/schema/archive";
import { templates, templateInventory } from "@matms/db/schema/inventory";
import { and, eq } from "drizzle-orm";
import { createBox, createCategory, createDocument, createFolder, createLocation } from "./archive-service";
import { createInventoryLine, createTemplate } from "./inventory-service";
import { provisionAccount } from "@matms/auth/provisioning";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/_(dev|test)$/.test(new URL(databaseUrl).pathname)) throw new Error("Development seed requires a database name ending in _dev or _test.");
if (!process.env.SEED_ADMIN_EMAIL) throw new Error("SEED_ADMIN_EMAIL must identify an existing active Administrator.");
const db = createDb({ DATABASE_URL: databaseUrl });

async function main() {
  const [profile] = await db.select({ id: user.id, active: userProfiles.active, role: userProfiles.role }).from(user).innerJoin(userProfiles, eq(user.id, userProfiles.userId)).where(eq(user.email, process.env.SEED_ADMIN_EMAIL!)).limit(1);
  if (!profile?.active || profile.role !== "admin") throw new Error("Seed operator must be an active Administrator.");
  const actor = { id: profile.id, role: "admin" as const };
  const correlationId = crypto.randomUUID();
  if (process.env.SEED_DEMO_PASSWORD) {
    for (const [role, email] of [["staff", process.env.SEED_STAFF_EMAIL], ["viewer", process.env.SEED_VIEWER_EMAIL]] as const) {
      if (email && !(await db.select().from(user).where(eq(user.email, email)).limit(1)).length) await provisionAccount(db, { name: `Fictional ${role}`, email, password: process.env.SEED_DEMO_PASSWORD, role, actorId: actor.id, mustChangePassword: false, correlationId });
    }
  }
  for (const [code, name] of [["PERSONNEL", "Personnel"], ["FINANCE", "Finance"], ["ACADEMIC", "Academic"], ["ADMINISTRATIVE", "Administrative"], ["STUDENT-RECORDS", "Student Records"]]) {
    if (!(await db.select().from(categories).where(eq(categories.normalizedCode, code!)).limit(1)).length) await createCategory(db, actor, { code: code!, name: name!, correlationId });
  }
  const [category] = await db.select().from(categories).where(eq(categories.normalizedCode, "ADMINISTRATIVE")).limit(1);
  let [location] = await db.select().from(shelfLocations).where(eq(shelfLocations.normalizedCode, "DEMO-ROOM-A-01")).limit(1);
  location ??= await createLocation(db, actor, { code: "DEMO-ROOM-A-01", room: "Fictional demo room", shelf: "A", rack: "01", label: "Demo room / A / 01", correlationId });
  let [box] = await db.select().from(boxes).where(eq(boxes.normalizedCode, "DEMO-FORMS-01")).limit(1);
  box ??= await createBox(db, actor, { code: "DEMO-FORMS-01", categoryId: category!.id, shelfLocationId: location.id, confidentiality: "internal", notes: "Fictional demonstration only", correlationId });
  let [folder] = await db.select().from(folders).where(eq(folders.normalizedCode, "DEMO-BLANK-FORMS")).limit(1);
  folder ??= await createFolder(db, actor, { boxId: box.id, code: "DEMO-BLANK-FORMS", name: "Fictional blank forms", color: "blue", confidentiality: "internal", isTemplateFolder: true, correlationId });
  if (!(await db.select().from(documents).where(eq(documents.normalizedCode, "DEMO-DOCUMENT-01")).limit(1)).length) await createDocument(db, actor, { folderId: folder.id, code: "DEMO-DOCUMENT-01", title: "Fictional sample record", description: "Demonstration metadata; no real person's information.", confidentiality: "internal", correlationId });
  let [template] = await db.select().from(templates).where(eq(templates.normalizedCode, "DEMO-LEAVE-V1")).limit(1);
  if (!template) {
    template = await createTemplate(db, actor, { code: "DEMO-LEAVE-V1", familyCode: "DEMO-LEAVE", name: "Fictional leave form", categoryId: category!.id, revisionLabel: "Demo v1", digitalUrl: "https://example.org/", correlationId });
  }
  if (!(await db.select().from(templateInventory).where(and(eq(templateInventory.templateId, template.id), eq(templateInventory.folderId, folder.id))).limit(1)).length) await createInventoryLine(db, actor, { templateId: template.id, folderId: folder.id, threshold: 5, correlationId });
  console.info("Development seed completed. Existing entries and balances were preserved; new stock lines start at zero. Use Receive after a verified count.");
}

try { await main(); } finally { await db.$client.end(); }
