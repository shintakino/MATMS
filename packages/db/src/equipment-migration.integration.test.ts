import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
const migration="20261116235141_futuristic_gabe_jones";
for(const populated of [false,true])test(`equipment migration ${populated?"preserves populated inventory":"creates an empty device register on a fresh schema"}`,async()=>{
  const raw=process.env.TEST_DATABASE_URL;
  if(!raw||!new URL(raw).pathname.endsWith("_test"))throw new Error("Migration tests require an isolated _test database.");
  const name=`matms_equipment_${crypto.randomUUID().replaceAll("-","")}_test`,target=new URL(raw);target.pathname=`/${name}`;
  const owner=new Client({connectionString:raw}),client=new Client({connectionString:target.toString()});
  await owner.connect();let created=false,connected=false;
  try{
    await owner.query(`CREATE DATABASE "${name}"`);created=true;await client.connect();connected=true;
    const directory=fileURLToPath(new URL("./migrations/",import.meta.url).href);
    async function apply(folder:string){await client.query("BEGIN");for(const statement of readFileSync(`${directory}/${folder}/migration.sql`,"utf8").split("--> statement-breakpoint"))if(statement.trim())await client.query(statement);await client.query("COMMIT");}
    for(const folder of readdirSync(directory).filter(v=>/^\d{14}_/.test(v)&&v<migration).sort())await apply(folder);
    if(populated){
      await client.query(`INSERT INTO "user"(id,name,email) VALUES ('migration-owner','Fictional custodian','equipment@example.test')`);
      await client.query(`INSERT INTO user_profiles(user_id,role,must_change_password) VALUES ('migration-owner','property_custodian',false)`);
      const item=(await client.query(`INSERT INTO custodial_items(code,normalized_code,article,description,unit) VALUES ('LEGACY-2026','LEGACY-2026','Existing device','Existing description','unit') RETURNING id`)).rows[0].id;
      const lot=(await client.query(`INSERT INTO custodial_lots(item_id,reporting_class,property_number,normalized_property_number,unit_value,fund_cluster,office) VALUES ($1,'semi_expendable','OLD-001','OLD-001',1500,'TEST','Store') RETURNING id`,[item])).rows[0].id;
      const balance=(await client.query(`INSERT INTO custodial_balances(item_id,lot_id,fund_cluster,office,quantity,version) VALUES ($1,$2,'TEST','Store',0,2) RETURNING id`,[item,lot])).rows[0].id;
      for(const [type,delta,before,after] of [["opening",1,0,1],["issue",-1,1,0]] as const){
        const operation=(await client.query(`INSERT INTO custodial_operations(operation_id,actor_id,operation_type,transaction_date,reference,reason,counterparty,payload_fingerprint,result) VALUES ($1,'migration-owner',$2,'2026-01-01','Historical reference','Historical reason','Existing teacher','historical','{}') RETURNING id`,[crypto.randomUUID(),type])).rows[0].id;
        await client.query(`INSERT INTO custodial_transactions(operation_id,balance_id,delta,balance_before,balance_after) VALUES ($1,$2,$3,$4,$5)`,[operation,balance,delta,before,after]);
      }
    }
    async function hashes(){const result:Record<string,string[]>={};for(const table of ["user","user_profiles","custodial_items","custodial_lots","custodial_balances","custodial_operations","custodial_transactions","audit_logs","custodial_ics_exports"])result[table]=(await client.query(`SELECT md5(to_jsonb(t)::text) AS hash FROM "${table}" t ORDER BY hash`)).rows.map(row=>row.hash);return result;}
    const before=await hashes();await apply(migration);expect(await hashes()).toEqual(before);
    expect((await client.query("SELECT count(*)::int AS n FROM custodial_equipment_units")).rows[0].n).toBe(0);
    expect((await client.query("SELECT count(*)::int AS n FROM custodial_equipment_events")).rows[0].n).toBe(0);
    const triggers=(await client.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'equipment_%' ORDER BY tgname")).rows.map(row=>row.tgname);
    expect(triggers).toEqual(["equipment_balance_consistent","equipment_event_protected","equipment_head_protected","equipment_state_consistent"]);
    expect((await client.query("SELECT indexname FROM pg_indexes WHERE indexname IN ('equipment_lot_unique','equipment_number_unique','equipment_serial_unique','equipment_event_version_unique','equipment_event_transaction_unique')")).rows).toHaveLength(5);
  }finally{if(connected)await client.end();if(created)await owner.query(`DROP DATABASE "${name}"`);await owner.end();}
},30000);
