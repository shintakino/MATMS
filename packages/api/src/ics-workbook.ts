import { z } from "zod";
import { icsDetails, icsPayload as legacyPayload, renderIcs as renderLegacy } from "./ics-workbook-v1";
import template from "./ics-template-v2";
import { renderIcsV2 } from "./ics-workbook-v2";
import { renderIcsV3 } from "./ics-workbook-v3";
import { renderIcsV4 } from "./ics-workbook-v4";
import { icsItemNumber } from "./ics-item-number";
export { icsDetails, icsCost } from "./ics-workbook-v1";
export const icsDraftDetails = icsDetails.omit({number:true}).extend({
  lines:z.array(z.object({transactionId:z.uuid(),usefulLife:z.string().trim().min(1).max(240),description:z.string().trim().min(1).max(10000).optional()})).min(1).max(2000),
}).strip();
const v2Payload = legacyPayload.extend({version:z.literal("ics-v2"),sourceHash:z.literal(template.sourceHash)});
const v3Payload = legacyPayload.extend({version:z.literal("ics-v3"),sourceHash:z.literal(template.sourceHash)});
const v4Payload = legacyPayload.extend({version:z.literal("ics-v4"),sourceHash:z.literal(template.sourceHash)});
const sequence = z.string().regex(/^[1-9]\d*$/).max(30);
const numberedLine = legacyPayload.shape.lines.element.extend({itemNumber:z.string().min(1).max(1100),itemCode:z.string().min(1).max(1005),sequenceStart:sequence,sequenceEnd:sequence}).superRefine((line,ctx)=>{
  try {
    if (line.itemNumber !== icsItemNumber(line.itemCode,line.quantity,BigInt(line.sequenceStart),BigInt(line.sequenceEnd))) throw new Error();
  } catch { ctx.addIssue({code:"custom",message:"ICS item number must match its frozen code, sequence and quantity."}); }
});
export const icsCurrentPayload = legacyPayload.extend({version:z.literal("ics-v5"),sourceHash:z.literal(template.sourceHash),lines:z.array(numberedLine).min(1).max(2000)});
const deviceLine = legacyPayload.shape.lines.element.extend({
  quantity:z.literal(1), itemNumber:z.string().min(1).max(240),
  device:z.object({unitId:z.uuid(),eventId:z.uuid(),personId:z.uuid(),personName:z.string().min(1),permanentNumber:z.string().min(1).max(240),brand:z.string().min(1),model:z.string().min(1),serialNumber:z.string().nullable(),missingSerialReason:z.string().nullable()}),
}).superRefine((line,ctx)=>{if(line.itemNumber!==line.device.permanentNumber)ctx.addIssue({code:"custom",message:"Device ICS must retain its permanent property number."});});
const devicePayload = legacyPayload.extend({version:z.literal("ics-v6"),sourceHash:z.literal(template.sourceHash),lines:z.array(z.union([numberedLine,deviceLine])).min(1).max(2000)});
const correctedDeviceLine = deviceLine.safeExtend({device:deviceLine.shape.device.extend({sourceEventId:z.uuid(),identityVersion:z.number().int().nonnegative().nullable()})});
const correctedDevicePayload = legacyPayload.extend({version:z.literal("ics-v7"),sourceHash:z.literal(template.sourceHash),lines:z.array(z.union([numberedLine,correctedDeviceLine])).min(1).max(2000)});
export function icsPrintedDescription(line:{description:string;device?:{brand:string;model:string;serialNumber:string|null;missingSerialReason:string|null}}) {
  return line.device ? `${line.description}\n${line.device.brand} ${line.device.model}\nSerial: ${line.device.serialNumber??`Unavailable (${line.device.missingSerialReason})`}` : line.description;
}
export const icsPayload = z.discriminatedUnion("version",[legacyPayload,v2Payload,v3Payload,v4Payload,icsCurrentPayload,devicePayload,correctedDevicePayload]);
export type IcsPayload = z.infer<typeof icsPayload>;
export type IcsDraftDetails = z.infer<typeof icsDraftDetails>;
export async function renderIcs(input: unknown) {
  const payload = icsPayload.parse(input);
  if(payload.version==="ics-v6")return renderIcsV4({...payload,lines:payload.lines.map(line=>({...line,description:icsPrintedDescription(line)}))});
  if(payload.version==="ics-v7")return renderIcsV4({...payload,lines:payload.lines.map(line=>({...line,description:icsPrintedDescription(line)}))});
  return payload.version === "ics-v1" ? renderLegacy(payload) : payload.version === "ics-v2" ? renderIcsV2(payload) : payload.version === "ics-v3" ? renderIcsV3(payload) : renderIcsV4(payload);
}
