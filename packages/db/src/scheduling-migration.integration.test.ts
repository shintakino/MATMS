import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

test("populated scheduling upgrade preserves history and moves overlap ownership to beneficiaries", async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || !new URL(raw).pathname.endsWith("_test")) throw new Error("Migration verification requires an isolated _test database.");
  const name = `matms_migration_${crypto.randomUUID().replaceAll("-", "")}_test`;
  const source = new URL(raw), target = new URL(raw); target.pathname = "/" + name;
  const owner = new Client({ connectionString: source.toString() }), client = new Client({ connectionString: target.toString() });
  await owner.connect();
  let created = false, connected = false;
  try {
    await owner.query(`CREATE DATABASE "${name}"`); created = true;
    await client.connect(); connected = true;
    const directory = fileURLToPath(new URL("./migrations/", import.meta.url).href);
    const migration = "20261104135329_scheduling-delegation";
    for (const entry of readdirSync(directory).filter(entry => /^\d{14}_/.test(entry) && entry < migration).sort()) {
      for (const statement of readFileSync(`${directory}/${entry}/migration.sql`, "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
    }
    await client.query(`INSERT INTO "user" (id,name,email) VALUES ('old-teacher','Fictional legacy teacher','teacher@example.test'), ('old-personnel','Fictional legacy personnel','personnel@example.test')`);
    await client.query(`INSERT INTO user_profiles (user_id,role,must_change_password) VALUES ('old-teacher','staff',false),('old-personnel','admin',false)`);
    await client.query(`INSERT INTO employment_assignments (user_id,category) VALUES ('old-teacher','teacher'),('old-personnel','personnel')`);
    await client.query(`INSERT INTO scheduling_policy (id,leave_enabled,public_leave,teacher_limit,personnel_limit,version) VALUES (1,true,true,2,3,4)`);
    const teacherOperation = crypto.randomUUID(), personnelOperation = crypto.randomUUID();
    await client.query(`INSERT INTO leave_bookings (requester_id,category,start_date,end_date,reason,status,operation_id,fingerprint) VALUES ('old-teacher','teacher','2028-01-10','2028-01-11','Historical teacher reason','approved',$1,$3),('old-personnel','personnel','2028-01-10','2028-01-10','Historical personnel reason','pending',$2,$3)`, [teacherOperation, personnelOperation, "a".repeat(64)]);
    const resource = (await client.query(`INSERT INTO bookable_resources (name,normalized_name,kind,published) VALUES ('Fictional old hall','FICTIONAL OLD HALL','facility',true) RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO resource_bookings (resource_id,requester_id,start_date,end_date,purpose,operation_id,fingerprint) VALUES ($1,'old-teacher','2028-01-10','2028-01-11','Historical reservation',$2,$3)`, [resource, crypto.randomUUID(), "b".repeat(64)]);
    const oldLeave = (await client.query("SELECT id,requester_id,category,start_date,end_date,reason,status,version,operation_id,fingerprint FROM leave_bookings ORDER BY id")).rows;
    const oldReservation = (await client.query("SELECT id,requester_id,resource_id,start_date,end_date,purpose,status,version,operation_id,fingerprint FROM resource_bookings ORDER BY id")).rows;
    const oldAccounts = (await client.query('SELECT * FROM "user" ORDER BY id')).rows;
    await client.query("BEGIN");
    try {
      for (const statement of readFileSync(`${directory}/${migration}/migration.sql`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.query(statement);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    expect((await client.query("SELECT id,requester_id,category,start_date,end_date,reason,status,version,operation_id,fingerprint FROM leave_bookings ORDER BY id")).rows).toEqual(oldLeave);
    expect((await client.query("SELECT id,requester_id,resource_id,start_date,end_date,purpose,status,version,operation_id,fingerprint FROM resource_bookings ORDER BY id")).rows).toEqual(oldReservation);
    expect((await client.query('SELECT * FROM "user" ORDER BY id')).rows).toEqual(oldAccounts);
    const people = (await client.query("SELECT id,name,category,user_id FROM scheduling_people ORDER BY category")).rows;
    expect(people).toHaveLength(2);
    expect(people.find(person => person.category === "teacher")).toMatchObject({ name: "Fictional legacy teacher", user_id: null });
    expect(people.find(person => person.category === "personnel")).toMatchObject({ user_id: "old-personnel" });
    expect((await client.query("SELECT teacher_limit,personnel_limit,shs_limit,jhs_limit,version FROM scheduling_policy")).rows[0]).toEqual({ teacher_limit: 2, personnel_limit: 3, shs_limit: null, jhs_limit: null, version: 4 });
    expect((await client.query("SELECT person_name,beneficiary_category FROM resource_bookings")).rows[0]).toEqual({ person_name: "Fictional legacy teacher", beneficiary_category: "teacher" });
    const beneficiary = people.find(person => person.category === "teacher").id;
    await expect(client.query(`INSERT INTO leave_bookings (requester_id,person_id,person_name,category,start_date,end_date,reason,operation_id,fingerprint) VALUES ('old-personnel',$1,'Fictional legacy teacher','teacher','2028-01-10','2028-01-10','Overlap from another filer',$2,$3)`, [beneficiary, crypto.randomUUID(), "c".repeat(64)])).rejects.toMatchObject({ code: "23P01" });
    const second = (await client.query("INSERT INTO scheduling_people (code,name,category) VALUES ('NEW-JHS','Fictional JHS teacher','jhs') RETURNING id")).rows[0].id;
    await client.query(`INSERT INTO leave_bookings (requester_id,person_id,person_name,category,start_date,end_date,reason,operation_id,fingerprint) VALUES ('old-personnel',$1,'Fictional JHS teacher','jhs','2028-01-10','2028-01-10','Same filer, different beneficiary',$2,$3)`, [second, crypto.randomUUID(), "d".repeat(64)]);
    expect((await client.query("SELECT count(*)::int AS total FROM leave_bookings")).rows[0].total).toBe(3);
    expect((await client.query("SELECT count(*)::int AS total FROM user_profiles WHERE active")).rows[0].total).toBe(2);
  } finally {
    if (connected) await client.end();
    if (created) await owner.query(`DROP DATABASE "${name}"`);
    await owner.end();
  }
}, 30000);
