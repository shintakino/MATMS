import { z } from "zod";
import { icsDetails, icsPayload as legacyPayload, renderIcs as renderLegacy } from "./ics-workbook-v1";
import template from "./ics-template-v2";
import { renderIcsV2 } from "./ics-workbook-v2";
export { icsDetails, icsCost } from "./ics-workbook-v1";
export const icsDraftDetails = icsDetails.omit({number:true}).extend({
  lines:z.array(z.object({transactionId:z.uuid(),usefulLife:z.string().trim().min(1).max(240),description:z.string().trim().min(1).max(10000).optional()})).min(1).max(2000),
}).strip();
export const icsCurrentPayload = legacyPayload.extend({version:z.literal("ics-v2"),sourceHash:z.literal(template.sourceHash)});
export const icsPayload = z.discriminatedUnion("version",[legacyPayload,icsCurrentPayload]);
export type IcsPayload = z.infer<typeof icsPayload>;
export type IcsDraftDetails = z.infer<typeof icsDraftDetails>;
export async function renderIcs(input: unknown) {
  const payload = icsPayload.parse(input);
  return payload.version === "ics-v1" ? renderLegacy(payload) : renderIcsV2(payload);
}
