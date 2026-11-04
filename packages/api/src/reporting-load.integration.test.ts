import { afterAll, expect, test } from "bun:test";
import { eq, like, sql } from "drizzle-orm";

import { createDb } from "@matms/db";
import { boxes, categories, documents, folders, shelfLocations } from "@matms/db/schema/archive";
import { templateInventory, templates } from "@matms/db/schema/inventory";

import { queryReport, buildReportQuery } from "./reporting-service";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to an isolated _test database.");
const db = createDb({ DATABASE_URL: url });
const prefix = `BENCH-${crypto.randomUUID()}`;
const categoryId = crypto.randomUUID();
const locationId = crypto.randomUUID();
const templateId = crypto.randomUUID();

afterAll(async () => {
  await db.delete(templateInventory).where(eq(templateInventory.templateId, templateId));
  await db.delete(templates).where(eq(templates.id, templateId));
  await db.delete(documents).where(like(documents.normalizedCode, `${prefix}-D-%`));
  await db.delete(folders).where(like(folders.normalizedCode, `${prefix}-F-%`));
  await db.delete(boxes).where(like(boxes.normalizedCode, `${prefix}-B-%`));
  await db.delete(shelfLocations).where(eq(shelfLocations.id, locationId));
  await db.delete(categories).where(eq(categories.id, categoryId));
}, 30_000);

test("synthetic archive search records concurrent latency and query plans", async () => {
  await db.insert(categories).values({ id: categoryId, code: prefix, normalizedCode: prefix, name: "Synthetic benchmark" });
  await db.insert(shelfLocations).values({ id: locationId, code: prefix, normalizedCode: prefix, room: "Synthetic", shelf: "A", rack: "1", label: "Synthetic shelf" });
  await db.execute(sql`INSERT INTO boxes (id, code, normalized_code, category_id, shelf_location_id)
    SELECT gen_random_uuid(), ${prefix} || '-B-' || n, ${prefix} || '-B-' || n, ${categoryId}::uuid, ${locationId}::uuid FROM generate_series(1, 500) n`);
  await db.execute(sql`INSERT INTO folders (id, box_id, code, normalized_code, name, is_template_folder)
    SELECT gen_random_uuid(), b.id, ${prefix} || '-F-' || n, ${prefix} || '-F-' || n, 'Synthetic folder ' || n, true
    FROM generate_series(1, 5000) n JOIN boxes b ON b.normalized_code = ${prefix} || '-B-' || (((n - 1) % 500) + 1)`);
  await db.execute(sql`INSERT INTO documents (id, folder_id, code, normalized_code, title)
    SELECT gen_random_uuid(), f.id, ${prefix} || '-D-' || n, ${prefix} || '-D-' || n, 'Synthetic document ' || n
    FROM generate_series(1, 50000) n JOIN folders f ON f.normalized_code = ${prefix} || '-F-' || (((n - 1) % 5000) + 1)`);
  await db.insert(templates).values({ id: templateId, code: prefix, normalizedCode: prefix, familyCode: prefix, name: "Synthetic template", categoryId, revisionLabel: "1", digitalUrl: "https://example.test/fixture" });
  await db.execute(sql`INSERT INTO template_inventory (id, template_id, folder_id, count, threshold, version)
    SELECT gen_random_uuid(), ${templateId}::uuid, f.id, 3, 5, 0 FROM folders f WHERE f.normalized_code LIKE ${`${prefix}-F-%`} ORDER BY f.normalized_code LIMIT 2000`);

  const plan = await db.execute(sql`EXPLAIN SELECT id FROM documents WHERE normalized_code = ${`${prefix}-D-1`}`);
  const actor = { id: "benchmark-admin", role: "admin" as const };
  const filters = { query: prefix, ...(process.env.REPORT_SEARCH_KIND === "all" ? {} : { kind: "document" as const }) };
  if (process.env.REPORT_EXPLAIN === "1") {
    const explain = await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${buildReportQuery(actor, "search", filters, 1, 25)}`);
    console.info(JSON.stringify(Array.isArray(explain) ? explain : explain.rows));
    return;
  }
  await queryReport(db, actor, "search", filters, 1, 25);
  const timings: number[] = [];
  for (let batch = 0; batch < 3; batch++) {
    await Promise.all(Array.from({ length: 20 }, async () => {
      const started = performance.now();
      const result = await queryReport(db, actor, "search", filters, 1, 25);
      timings.push(performance.now() - started);
      expect(result.rows).toHaveLength(25);
      expect(result.hasMore).toBe(true);
    }));
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
  console.info(JSON.stringify({ fixture: { boxes: 500, folders: 5000, documents: 50000, inventory: 2000, concurrent: 20 }, samples: timings.length, p95Ms: Math.round(p95 ?? 0), lookupPlan: Array.isArray(plan) ? plan : plan.rows }));
  expect(p95).toBeLessThanOrEqual(500);
}, 180000);
