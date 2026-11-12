import type { IcsPayload } from "./ics-workbook";
import { renderIcsV3 } from "./ics-workbook-v3";

/** ISO dates have already been validated; format without timezone conversion. */
function printedDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${month}-${day}-${year}`;
}

export async function renderIcsV4(data: IcsPayload) {
  return renderIcsV3({
    ...data,
    details: {
      ...data.details,
      fromDate: printedDate(data.details.fromDate),
      toDate: printedDate(data.details.toDate),
    },
  });
}
