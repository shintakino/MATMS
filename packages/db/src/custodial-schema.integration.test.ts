import { expect, test } from "bun:test";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to an isolated _test database.");

test("custodial schema enforces balance scope and property uniqueness", async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("BEGIN");
  try {
    const item = (await client.query("INSERT INTO custodial_items (code, normalized_code, article, description, unit) VALUES ($1,$1,'Test','Test','pc') RETURNING id", [crypto.randomUUID()])).rows[0].id;
    const other = (await client.query("INSERT INTO custodial_items (code, normalized_code, article, description, unit) VALUES ($1,$1,'Test','Test','pc') RETURNING id", [crypto.randomUUID()])).rows[0].id;
    const property = crypto.randomUUID();
    const lot = (await client.query("INSERT INTO custodial_lots (item_id, reporting_class, property_number, normalized_property_number, fund_cluster, office) VALUES ($1,'ppe',$2,$2,'TEST','A') RETURNING id", [item, property])).rows[0].id;
    async function rejects(sql: string, args: unknown[]) {
      await client.query("SAVEPOINT constraint_check");
      try { await expect(client.query(sql, args)).rejects.toThrow(); }
      finally { await client.query("ROLLBACK TO SAVEPOINT constraint_check"); }
    }
    await rejects("INSERT INTO custodial_lots (item_id, reporting_class, property_number, normalized_property_number, fund_cluster, office) VALUES ($1,'ppe',$2,$2,'TEST','A')", [item, property]);
    await rejects("INSERT INTO custodial_balances (item_id, lot_id, fund_cluster, office) VALUES ($1,$2,'TEST','A')", [other, lot]);
    await rejects("INSERT INTO custodial_balances (item_id, lot_id, fund_cluster, office, quantity) VALUES ($1,$2,'TEST','A',-1)", [item, lot]);
    await client.query("INSERT INTO custodial_balances (item_id, fund_cluster, office) VALUES ($1,'TEST','A')", [item]);
    await rejects("INSERT INTO custodial_balances (item_id, fund_cluster, office) VALUES ($1,'TEST','A')", [item]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
