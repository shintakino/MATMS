import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { identityRouter } from "./identity";
import { archiveRouter } from "./archive";
import { inventoryRouter } from "./inventory";
import { custodyRouter } from "./custody";
import { reportingRouter } from "./reporting";
import { adminRouter } from "./admin";
import { physicalCountsRouter } from "./physical-counts";
import { custodialInventoryRouter } from "./custodial-inventory";
import { custodialImportsRouter } from "./custodial-imports";
import { inventoryReportsRouter } from "./inventory-reports";
import { inventoryIcsRouter } from "./inventory-ics";
import { schedulingRouter } from "./scheduling";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  identity: identityRouter,
  archive: archiveRouter,
  inventory: inventoryRouter,
  custody: custodyRouter,
  reporting: reportingRouter,
  admin: adminRouter,
  physicalCounts: physicalCountsRouter,
  custodialInventory: custodialInventoryRouter,
  inventoryImports: custodialImportsRouter,
  inventoryReports: inventoryReportsRouter,
  inventoryIcs: inventoryIcsRouter,
  scheduling: schedulingRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
