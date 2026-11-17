import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { createDb, type Database } from "@matms/db";
import { user } from "@matms/db/schema/auth";
import { userProfiles } from "@matms/db/schema/identity";
import { equipmentUnits, equipmentEvents } from "@matms/db/schema/equipment";
import { schedulingPeople, bookableResources } from "@matms/db/schema/scheduling";
import { custodialCounts, custodialCountLines, custodialTransactions, custodialOperations } from "@matms/db/schema/custodial-inventory";
import { createCustodialItem, createCustodialLot, createCustodialBalance, postCustodialOperation, previewCustodialOperation, createCustodialCount, createCustodialFormProfile, custodialProfileDefinition, previewCustodialCountRefresh, refreshCustodialCount, getCustodialCount, updateCustodialItem, updateCustodialLot } from "./custodial-service";
import { equipmentRegisterInput, registerEquipment, actOnEquipment, getEquipment, listEquipment, listEquipmentPeople } from "./equipment-service";
import { generateIcs, listIcsIssues, previewIcs, updateIcs, downloadIcs } from "./ics-service";
import { saveBookableResource } from "./scheduling-service";
import { inventoryProfileTemplate } from "./inventory-profile-templates";

const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith("_test"))throw new Error("Equipment tests require an isolated _test database.");
const db=createDb({DATABASE_URL:url});afterAll(()=>db.$client.end());
const op=()=>({operationId:crypto.randomUUID(),correlationId:crypto.randomUUID()});
const rollback=new Error("Rollback fictional device fixtures");
async function fixture(local:Database){
  const ids={admin:crypto.randomUUID(),custodian:crypto.randomUUID(),staff:crypto.randomUUID(),viewer:crypto.randomUUID()};
  for(const [role,id] of Object.entries(ids)){
    await local.insert(user).values({id,name:`Fictional ${role}`,email:`${id}@example.test`,emailVerified:true});
    await local.insert(userProfiles).values({userId:id,role:role==="custodian"?"property_custodian":role as "admin"|"staff"|"viewer",active:true,mustChangePassword:false});
  }
  const actor={id:ids.custodian};
  const persons=await local.insert(schedulingPeople).values(["A","B","Same A"].map((suffix)=>({name:suffix==="Same A"?"Fictional Teacher A":`Fictional Teacher ${suffix}`,code:crypto.randomUUID().toUpperCase(),category:"jhs" as const}))).returning();
  const item=await createCustodialItem(local,actor,{code:`ICT-${crypto.randomUUID()}`,article:"Fictional laptop",description:"School ICT device",unit:"unit",reorderPoint:null,...op()});
  async function source(quantity=1,reportingClass:"semi_expendable"|"ppe"="semi_expendable"){
    const number=`ICT-${crypto.randomUUID()}`;
    const lot=await createCustodialLot(local,actor,{itemId:item.id,reportingClass,propertyNumber:number,unitValue:"24500.00",fundCluster:item.id,office:"ICT Store",acquiredOn:"2026-01-01",...op()});
    const balance=await createCustodialBalance(local,actor,{itemId:item.id,lotId:lot.id,fundCluster:item.id,office:"ICT Store",...op()});
    await postCustodialOperation(local,actor,{balanceId:balance.id,type:"opening",quantity,transactionDate:"2026-01-01",reference:"Verified opening",reason:"Fixture",...op()});
    const registration={balanceId:balance.id,mode:"available" as const,permanentNumber:number,brand:"Fictional Brand",model:"Laptop 1",notes:"Internal equipment note — managers only",accessories:"Charger and carry bag",serialNumber:crypto.randomUUID(),missingSerialReason:null,location:"ICT Store",condition:"serviceable",effectiveDate:"2026-01-01",reference:"Device verification",reason:"Fixture",confirmed:true as const,operationId:crypto.randomUUID()};
    return {lot,balance,registration};
  }
  const action=(id:string,expectedVersion:number,action:Parameters<typeof actOnEquipment>[2]["action"],extra:Partial<Parameters<typeof actOnEquipment>[2]>={})=>actOnEquipment(local,actor,{id,expectedVersion,action,effectiveDate:"2026-01-02",reference:"Physical handover",reason:"Classroom ICT use",location:"Room 1",condition:"serviceable",operationId:crypto.randomUUID(),...extra},crypto.randomUUID());
  return {ids,actor,persons,item,source,action};
}
async function isolated(run:(local:Database)=>Promise<void>){try{await db.transaction(async tx=>{await run(tx as unknown as Database);throw rollback;});}catch(e){if(e!==rollback)throw e;}}

test("per-device issue, witnessed reassignment, return, lifecycle, durable retry and role enforcement",()=>isolated(async local=>{
  const f=await fixture(local),s=await f.source();
  const saved=await registerEquipment(local,f.actor,s.registration,crypto.randomUUID());
  expect(await registerEquipment(local,f.actor,s.registration,crypto.randomUUID())).toEqual(saved);
  await expect(registerEquipment(local,f.actor,{...s.registration,brand:"Changed"},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
  for(const id of [f.ids.staff,f.ids.viewer]){
    await expect(getEquipment(local,{id},saved.id)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(listEquipmentPeople(local,{id},{})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(registerEquipment(local,{id},s.registration,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
  }
  const issue={id:saved.id,expectedVersion:0,action:"issue" as const,personId:f.persons[0]!.id,effectiveDate:"2026-01-02",reference:"Issue 1",reason:"Teaching",location:"Room A",condition:"serviceable",operationId:crypto.randomUUID()};
  await expect(actOnEquipment(local,f.actor,issue,null as unknown as string)).rejects.toThrow();
  expect((await getEquipment(local,f.actor,saved.id)).unit.state).toBe("available");
  expect((await getEquipment(local,f.actor,saved.id)).balance.quantity).toBe(1);
  await actOnEquipment(local,f.actor,issue,crypto.randomUUID());
  expect(await actOnEquipment(local,f.actor,issue,crypto.randomUUID())).toEqual({id:saved.id,version:1});
  await expect(f.action(saved.id,0,"issue",{personId:f.persons[1]!.id})).rejects.toMatchObject({code:"CONFLICT"});
  expect((await listEquipment(local,f.actor,{personId:f.persons[0]!.id})).rows.map(row=>row.unit.id)).toContain(saved.id);
  await expect(f.action(saved.id,1,"reassign",{personId:f.persons[1]!.id})).rejects.toMatchObject({code:"VALIDATION"});
  await f.action(saved.id,1,"reassign",{personId:f.persons[1]!.id,physicalHandover:true});
  let detail=await getEquipment(local,f.actor,saved.id);
  expect(detail.unit.personId).toBe(f.persons[1]!.id);expect(detail.balance.quantity).toBe(0);expect(detail.history).toHaveLength(3);
  const ledger=await local.select().from(custodialTransactions).where(eq(custodialTransactions.balanceId,s.balance.id));
  expect(ledger.map(row=>row.delta)).toEqual([1,-1,1,-1]);
  await f.action(saved.id,2,"repair");expect((await getEquipment(local,f.actor,saved.id)).unit.personId).toBe(f.persons[1]!.id);
  await f.action(saved.id,3,"repaired");await f.action(saved.id,4,"lost");
  detail=await getEquipment(local,f.actor,saved.id);expect(detail.unit.personId).toBe(f.persons[1]!.id);expect(detail.balance.quantity).toBe(0);
  await expect(f.action(saved.id,5,"return",{physicalHandover:true})).rejects.toMatchObject({code:"CONFLICT"});
  await local.update(schedulingPeople).set({active:false}).where(eq(schedulingPeople.id,f.persons[1]!.id));
  await f.action(saved.id,5,"recover",{physicalHandover:true,location:"ICT Store"});
  expect((await getEquipment(local,f.actor,saved.id)).balance.quantity).toBe(1);
  await expect(f.action(saved.id,6,"issue",{personId:f.persons[1]!.id})).rejects.toMatchObject({code:"CONFLICT"});
  await f.action(saved.id,6,"issue",{personId:f.persons[0]!.id});
  await f.action(saved.id,7,"return",{physicalHandover:true});
  await f.action(saved.id,8,"lost");expect((await getEquipment(local,f.actor,saved.id)).balance.quantity).toBe(0);
  await f.action(saved.id,9,"recover",{physicalHandover:true});
  await expect(f.action(saved.id,10,"dispose",{documentReference:"Approval"})).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(actOnEquipment(local,{id:f.ids.admin},{...issue,action:"dispose",expectedVersion:10,personId:undefined,operationId:crypto.randomUUID()},crypto.randomUUID())).rejects.toMatchObject({code:"VALIDATION"});
  await actOnEquipment(local,{id:f.ids.admin},{...issue,action:"dispose",expectedVersion:10,personId:undefined,operationId:crypto.randomUUID(),documentReference:"External approved disposal TEST"},crypto.randomUUID());
  detail=await getEquipment(local,f.actor,saved.id);expect(detail.unit.state).toBe("disposed");expect(detail.balance.quantity).toBe(0);
  await local.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);await local.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
  await local.update(userProfiles).set({active:false}).where(eq(userProfiles.userId,f.actor.id));
  await expect(registerEquipment(local,f.actor,s.registration,crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
}));

test("registration rejects batch conversions and duplicate identities; generic stock and retirement cannot bypass custody",()=>isolated(async local=>{
  const f=await fixture(local),s=await f.source(),batch=await f.source(90);
  await expect(registerEquipment(local,f.actor,batch.registration,crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
  const registered=await registerEquipment(local,f.actor,s.registration,crypto.randomUUID());
  await expect(saveBookableResource(local,{id:f.ids.admin,role:"admin"},{name:"Fictional reserved device",kind:"equipment",lotId:s.lot.id,publicDescription:"",active:true,published:false},crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
  const other=await f.source();
  await expect(registerEquipment(local,f.actor,{...other.registration,serialNumber:s.registration.serialNumber.toUpperCase()},crypto.randomUUID())).rejects.toThrow();
  await expect(registerEquipment(local,f.actor,{...other.registration,serialNumber:null,missingSerialReason:null},crypto.randomUUID())).rejects.toThrow();
  const posting={balanceId:s.balance.id,type:"issue" as const,quantity:1,transactionDate:"2026-01-02",reference:"Bypass",reason:"Bypass",counterparty:"Teacher",...op()};
  await expect(postCustodialOperation(local,f.actor,posting)).rejects.toMatchObject({code:"CONFLICT"});
  await expect(previewCustodialOperation(local,f.actor,posting)).rejects.toMatchObject({code:"CONFLICT"});
  const original={balanceId:s.balance.id,type:"opening" as const,quantity:1,transactionDate:"2026-01-01",reference:"Verified opening",reason:"Fixture",...op()};
  await expect(postCustodialOperation(local,f.actor,original)).rejects.toMatchObject({code:"CONFLICT"});
  await f.action(registered.id,0,"issue",{personId:f.persons[0]!.id});
  await expect(updateCustodialItem(local,f.actor,{itemId:f.item.id,expectedVersion:0,code:f.item.code,article:f.item.article,description:f.item.description,unit:f.item.unit,reorderPoint:null,defaultSectionId:null,notes:null,active:false,reason:"Retire",...op()})).rejects.toMatchObject({code:"CONFLICT"});
  await expect(updateCustodialLot(local,f.actor,{lotId:s.lot.id,expectedVersion:0,propertyNumber:"Changed",propertyExceptionId:null,unitValue:s.lot.unitValue,supplier:null,acquiredOn:s.lot.acquiredOn,yearLabel:null,fundCluster:s.lot.fundCluster,office:s.lot.office,accountableOfficer:null,condition:null,remarks:null,active:true,reason:"Change identity",...op()})).rejects.toMatchObject({code:"CONFLICT"});
  // Database guards reject direct identity edits and immutable-event changes too.
  await expect(local.transaction(async tx=>{await tx.update(equipmentUnits).set({permanentNumber:"HACK",version:2}).where(eq(equipmentUnits.id,registered.id));})).rejects.toThrow();
  await expect(local.transaction(async tx=>{await tx.delete(equipmentEvents).where(eq(equipmentEvents.unitId,registered.id));})).rejects.toThrow();
  const bookable=await f.source();
  await local.insert(bookableResources).values({name:bookable.lot.id,normalizedName:bookable.lot.id.toUpperCase(),kind:"equipment",lotId:bookable.lot.id,active:true});
  await expect(registerEquipment(local,f.actor,bookable.registration,crypto.randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
}));

test("adopts a real issue without posting stock and prints stable serial/property identity across teachers",()=>isolated(async local=>{
  const f=await fixture(local),s=await f.source();
  const old=await postCustodialOperation(local,f.actor,{balanceId:s.balance.id,type:"issue",quantity:1,transactionDate:"2026-01-02",reference:"Old issue",reason:"Deployed",counterparty:f.persons[0]!.name,...op()});
  const [issue]=await local.select({id:custodialTransactions.id}).from(custodialTransactions).innerJoin(custodialOperations,eq(custodialOperations.id,custodialTransactions.operationId)).where(eq(custodialOperations.operationId,old.operationId));
  const ledgerBefore=await local.select().from(custodialTransactions);
  const saved=await registerEquipment(local,f.actor,{...s.registration,mode:"adopt",issueTransactionId:issue!.id,personId:f.persons[0]!.id,effectiveDate:"2026-01-02"},crypto.randomUUID());
  expect(await local.select().from(custodialTransactions)).toEqual(ledgerBefore);
  const details={entity:"Fictional school",fromName:"ICT Custodian",fromOffice:"ICT Store",toName:f.persons[0]!.name,toOffice:"Room 1",fromDate:"2026-01-02",toDate:"2026-01-02",lines:[{transactionId:issue!.id,usefulLife:"5 years",description:"Custom device description"}]};
  const preview=await previewIcs(local,f.actor.id,details,crypto.randomUUID());
  expect(preview.payload.version).toBe("ics-v6");expect(preview.payload.lines[0]!.itemNumber).toBe(s.registration.permanentNumber);
  const doc=await generateIcs(local,f.actor.id,{details,expectedDataHash:preview.dataHash,operationId:crypto.randomUUID()},crypto.randomUUID());
  const file=await downloadIcs(local,f.actor.id,doc.id,crypto.randomUUID());
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(file.base64,"base64") as unknown as ExcelJS.Buffer);
  const cellText=book.worksheets.flatMap(sheet=>{const values:string[]=[];sheet.eachRow(row=>row.eachCell(cell=>{if(cell.value!==null)values.push(cell.text);}));return values;}).join(" ").replaceAll(/\s/g,"");
  expect(cellText).toContain(s.registration.serialNumber.replaceAll(/\s/g,""));expect(cellText).toContain(s.registration.permanentNumber);
  const newSource=await f.source(),newUnit=await registerEquipment(local,f.actor,newSource.registration,crypto.randomUUID());
  await f.action(newUnit.id,0,"issue",{personId:f.persons[0]!.id});
  const all=await listIcsIssues(local,f.actor.id,1,{personId:f.persons[0]!.id});expect(all.rows).toHaveLength(2);
  const many={...details,lines:all.rows.map(row=>({transactionId:row.transactionId,usefulLife:"5 years"}))};
  const multiPreview=await previewIcs(local,f.actor.id,many,crypto.randomUUID());expect(multiPreview.payload.lines).toHaveLength(2);expect(multiPreview.payload.lines[0]!.description).toContain("Accessories: Charger and carry bag");
  await f.action(saved.id,0,"reassign",{personId:f.persons[2]!.id,physicalHandover:true});
  const latest=(await getEquipment(local,f.actor,saved.id)).history[0]!;
  await expect(previewIcs(local,f.actor.id,{...many,lines:[many.lines[0]!,{transactionId:latest.transactionId!,usefulLife:"5 years"}]},crypto.randomUUID())).rejects.toThrow();
  expect((await previewIcs(local,f.actor.id,{...details,lines:[{transactionId:latest.transactionId!,usefulLife:"5 years"}]},crypto.randomUUID())).payload.lines[0]!.itemNumber).toBe(s.registration.permanentNumber);
  const editedDetails={...details,lines:[{...details.lines[0]!,description:"Changed description"}]};
  const edited=await previewIcs(local,f.actor.id,editedDetails,crypto.randomUUID(),{id:doc.id,expectedVersion:1});
  await updateIcs(local,f.actor.id,{id:doc.id,expectedVersion:1,details:editedDetails,reason:"Description correction",expectedDataHash:edited.dataHash,operationId:crypto.randomUUID()},crypto.randomUUID());
  expect((await getEquipment(local,f.actor,saved.id)).slips).toHaveLength(2);
  const historicalFile=await downloadIcs(local,f.actor.id,doc.id,crypto.randomUUID(),1);
  const historicalBook=new ExcelJS.Workbook();await historicalBook.xlsx.load(Buffer.from(historicalFile.base64,"base64") as unknown as ExcelJS.Buffer);
  expect(historicalBook.worksheets[0]!.getCell("E12").text).toBe(book.worksheets[0]!.getCell("E12").text);
  await f.action(saved.id,1,"return",{physicalHandover:true});
  await f.action(saved.id,2,"issue",{personId:f.persons[0]!.id});
  const repeated=(await getEquipment(local,f.actor,saved.id)).history[0]!;
  await expect(previewIcs(local,f.actor.id,{...details,lines:[details.lines[0]!,{transactionId:repeated.transactionId!,usefulLife:"5 years"}]},crypto.randomUUID())).rejects.toMatchObject({code:"VALIDATION_ERROR"});
  const ppe=await f.source(1,"ppe"),ppeUnit=await registerEquipment(local,f.actor,ppe.registration,crypto.randomUUID());
  await f.action(ppeUnit.id,0,"issue",{personId:f.persons[0]!.id,documentReference:"PAR TEST"});
  expect((await listIcsIssues(local,f.actor.id,1,{unitId:ppeUnit.id})).rows).toHaveLength(0);
  await f.action(ppeUnit.id,1,"return",{physicalHandover:true,needsRepair:true,condition:"needs_minor_repair"});
  expect((await getEquipment(local,f.actor,ppeUnit.id)).unit.state).toBe("under_repair");
  await expect(f.action(ppeUnit.id,2,"issue",{personId:f.persons[0]!.id})).rejects.toMatchObject({code:"CONFLICT"});
  expect(equipmentRegisterInput.safeParse({...s.registration,mode:"adopt",personId:undefined,issueTransactionId:undefined}).success).toBe(false);
}));

test("dated counts retain issued school ownership and require explicit refresh when custody changes",()=>isolated(async local=>{
  const f=await fixture(local),s=await f.source(),unit=await registerEquipment(local,f.actor,s.registration,crypto.randomUUID());
  const template=inventoryProfileTemplate("rpcsp");
  const profile=await createCustodialFormProfile(local,{id:f.ids.admin},{family:"rpcsp",effectiveFrom:"2026-01-01",sourceHash:template.sourceHash,versionNote:"Test profile",visualApproval:"Fictional fixture",definition:custodialProfileDefinition.parse(template.definition),...op()});
  const metadata={entity:"Fictional school",accountableOfficer:"Officer",accountableDesignation:"Officer",accountabilityAssumedDate:"2026-01-01",custodian:"Custodian",custodianDesignation:"Custodian",committeeChair:"Chair",committeeChairDesignation:"Chair",committeeMember:"Member",committeeMemberDesignation:"Member",schoolHead:"Head",schoolHeadDesignation:"Head"};
  await f.action(unit.id,0,"issue",{personId:f.persons[0]!.id,location:"Room A"});
  const count=await createCustodialCount(local,f.actor,{code:crypto.randomUUID(),family:"rpcsp",profileId:profile.id,asOfDate:"2026-01-03",fundCluster:f.item.id,office:"Room A",metadata,...op()});
  let lines=await local.select().from(custodialCountLines).where(eq(custodialCountLines.countId,count.id));
  expect(lines).toHaveLength(1);expect(lines[0]!.snapshot).toMatchObject({cardQuantity:1,accountableOfficer:f.persons[0]!.name,lotOffice:"Room A",propertyNumber:s.registration.permanentNumber});
  expect(JSON.stringify(lines[0]!.snapshot)).not.toContain("Internal equipment note");
  expect(lines[0]!.snapshot).toMatchObject({equipment:{state:"issued",personId:f.persons[0]!.id}});
  await f.action(unit.id,1,"lost",{effectiveDate:"2026-01-03",location:"Room A"});
  let plan=await previewCustodialCountRefresh(local,f.actor,count.id);expect(plan.changed).toHaveLength(1);
  expect((await local.select().from(custodialCountLines).where(eq(custodialCountLines.countId,count.id)))[0]!.snapshot).toEqual(lines[0]!.snapshot);
  await refreshCustodialCount(local,f.actor,{countId:count.id,expectedVersion:plan.version,planHash:plan.planHash,includeLotIds:[],...op()});
  lines=await local.select().from(custodialCountLines).where(eq(custodialCountLines.countId,count.id));expect(lines[0]!.reviewRequired).toBe(true);expect(lines[0]!.snapshot).toMatchObject({cardQuantity:1});
  await actOnEquipment(local,{id:f.ids.admin},{id:unit.id,expectedVersion:2,action:"dispose",effectiveDate:"2026-01-04",reference:"Approved relief",reason:"External approval",location:"Room A",condition:"lost",documentReference:"Approval TEST",operationId:crypto.randomUUID()},crypto.randomUUID());
  plan=await previewCustodialCountRefresh(local,f.actor,count.id);expect(plan.changed).toHaveLength(0);
  const after=await createCustodialCount(local,f.actor,{code:crypto.randomUUID(),family:"rpcsp",profileId:profile.id,asOfDate:"2026-01-04",fundCluster:f.item.id,office:"Room A",metadata,...op()});
  expect((await local.select().from(custodialCountLines).where(eq(custodialCountLines.countId,after.id)))[0]!.snapshot).toMatchObject({cardQuantity:0});
  // No finalized historical payload is rewritten by equipment activity.
  expect((await local.select().from(custodialCounts).where(eq(custodialCounts.id,count.id)))[0]!.status).toBe("draft");
  await expect(f.action(unit.id,3,"edit",{effectiveDate:"2026-01-01",metadata:{notes:"Backdate"}})).rejects.toThrow();
  expect((await getCustodialCount(local,f.actor,count.id)).count.id).toBe(count.id);
}));

test("concurrent issue and return commit once with consistent stock and immutable events",async()=>{
  const {readdirSync,readFileSync}=await import("node:fs"),{fileURLToPath}=await import("node:url");
  const name=`matms_equipment_race_${crypto.randomUUID().replaceAll("-","")}_test`,target=new URL(url!);target.pathname=`/${name}`;
  const owner=await db.$client.connect();let local:Database|undefined,created=false;
  try{
    await owner.query(`CREATE DATABASE "${name}"`);created=true;local=createDb({DATABASE_URL:target.toString()});
    const client=await local.$client.connect();
    try{await client.query("BEGIN");const directory=fileURLToPath(new URL("../../db/src/migrations/",import.meta.url).href);for(const folder of readdirSync(directory).filter(v=>/^\d{14}_/.test(v)).sort())for(const statement of readFileSync(`${directory}/${folder}/migration.sql`,"utf8").split("--> statement-breakpoint"))if(statement.trim())await client.query(statement);await client.query("COMMIT");}finally{client.release();}
    const f=await fixture(local),s=await f.source(),unit=await registerEquipment(local,f.actor,s.registration,crypto.randomUUID());
    const results=await Promise.allSettled([f.action(unit.id,0,"issue",{personId:f.persons[0]!.id}),f.action(unit.id,0,"issue",{personId:f.persons[1]!.id})]);
    expect(results.filter(v=>v.status==="fulfilled")).toHaveLength(1);
    let detail=await getEquipment(local,f.actor,unit.id);expect(detail.balance.quantity).toBe(0);expect(detail.history).toHaveLength(2);
    const returns=await Promise.allSettled([f.action(unit.id,1,"return",{physicalHandover:true}),f.action(unit.id,1,"return",{physicalHandover:true})]);
    expect(returns.filter(v=>v.status==="fulfilled")).toHaveLength(1);
    detail=await getEquipment(local,f.actor,unit.id);expect(detail.balance.quantity).toBe(1);expect(detail.history).toHaveLength(3);
    await expect(local.transaction(async tx=>{await tx.update(equipmentUnits).set({state:"issued",personId:f.persons[0]!.id,personName:f.persons[0]!.name,version:3}).where(eq(equipmentUnits.id,unit.id));})).rejects.toThrow();
    expect((await getEquipment(local,f.actor,unit.id)).unit.version).toBe(2);
    const race=await f.source();
    const registrationRace=await Promise.allSettled([
      registerEquipment(local,f.actor,race.registration,crypto.randomUUID()),
      postCustodialOperation(local,f.actor,{balanceId:race.balance.id,type:"issue",quantity:1,transactionDate:"2026-01-02",reference:"Concurrent posting",reason:"Fictional source lock check",counterparty:f.persons[0]!.name,...op()})
    ]);
    expect(registrationRace.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const registered=await local.select().from(equipmentUnits).where(eq(equipmentUnits.lotId,race.lot.id));
    if(registered[0])expect((await getEquipment(local,f.actor,registered[0].id)).balance.quantity).toBe(1);

  }finally{if(local)await local.$client.end();if(created)await owner.query(`DROP DATABASE "${name}"`);owner.release();}
},30000);
