import { z } from "zod";
import { icsDetails, icsPayload as legacyPayload, renderIcs as renderLegacy } from "./ics-workbook-v1";
import template from "./ics-template-v2";
import { renderIcsV2 } from "./ics-workbook-v2";
import { renderIcsV3 } from "./ics-workbook-v3";
import { renderIcsV4 } from "./ics-workbook-v4";
export { icsDetails, icsCost } from "./ics-workbook-v1";
export const icsDraftDetails = icsDetails.omit({number:true}).extend({
  lines:z.array(z.object({transactionId:z.uuid(),usefulLife:z.string().trim().min(1).max(240),description:z.string().trim().min(1).max(10000).optional()})).min(1).max(2000),
}).strip();
const v2Payload = legacyPayload.extend({version:z.literal("ics-v2"),sourceHash:z.literal(template.sourceHash)});
const v3Payload = legacyPayload.extend({version:z.literal("ics-v3"),sourceHash:z.literal(template.sourceHash)});
export const icsCurrentPayload = legacyPayload.extend({version:z.literal("ics-v4"),sourceHash:z.literal(template.sourceHash)});
export const icsPayload = z.discriminatedUnion("version",[legacyPayload,v2Payload,v3Payload,icsCurrentPayload]);
export type IcsPayload = z.infer<typeof icsPayload>;
export type IcsDraftDetails = z.infer<typeof icsDraftDetails>;
export async function renderIcs(input: unknown) {
  const payload = icsPayload.parse(input);
  return payload.version === "ics-v1" ? renderLegacy(payload) : payload.version === "ics-v2" ? renderIcsV2(payload) : payload.version === "ics-v3" ? renderIcsV3(payload) : renderIcsV4(payload);
}
