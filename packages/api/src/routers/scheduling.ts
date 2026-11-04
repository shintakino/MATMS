import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../index";
import { MatmsError } from "../errors";
import { availabilityInput, categorySchema, decisionInput, editLeaveInput, editReservationInput, leaveInput, pageInput, policyInput, reservationInput, resourceInput, scheduleDate } from "../scheduling-contract";
import * as service from "../scheduling-service";
import type { Context } from "../context";

const actor = (context: Context) => ({ id: context.session!.user.id, role: context.session!.profile.role });
const publicResource = z.object({ id: z.string().uuid(), name: z.string(), kind: z.enum(["equipment", "facility"]), description: z.string() });
const publicResourceCalendar = z.object({ resource: publicResource.nullable(), days: z.array(z.object({ day: scheduleDate, status: z.enum(["available", "reserved", "past"]) })).max(31) });
const leaveDayState = z.object({ status: z.enum(["past", "closed", "full", "available"]), remaining: z.number().int().nonnegative().nullable() });
const publicLeaveCalendar = z.object({ published: z.boolean(), enabled: z.boolean(), days: z.array(z.object({ day: scheduleDate, teacher: leaveDayState, personnel: leaveDayState })).max(31), approved: z.array(z.object({ name: z.string(), category: categorySchema, startDate: scheduleDate, endDate: scheduleDate })) });
async function handle<T>(run: () => Promise<T>) {
  try { return await run(); }
  catch (error) {
    if (error instanceof MatmsError) throw error.toORPCError();
    if (error instanceof z.ZodError) throw new MatmsError("VALIDATION_ERROR", error.issues[0]?.message ?? "Review the submitted fields.").toORPCError();
    throw error;
  }
}
export const schedulingRouter = {
  setup: protectedProcedure.handler(({ context }) => handle(() => service.getSchedulingSetup(context.db, actor(context)))),
  savePolicy: protectedProcedure.input(policyInput).handler(({ context, input }) => handle(() => service.saveSchedulingPolicy(context.db, actor(context), input, context.correlationId))),
  people: protectedProcedure.input(pageInput).handler(({ context, input }) => handle(() => service.schedulingPeople(context.db, actor(context), input))),
  saveEmployment: protectedProcedure.input(z.object({ userId: z.string().min(1).max(128), category: categorySchema, active: z.boolean() })).handler(({ context, input }) => handle(() => service.saveEmployment(context.db, actor(context), input, context.correlationId))),
  resources: protectedProcedure.input(pageInput).handler(({ context, input }) => handle(() => service.listBookableResources(context.db, actor(context), input))),
  lots: protectedProcedure.input(pageInput).handler(({ context, input }) => handle(() => service.bookableLotChoices(context.db, actor(context), input))),
  saveResource: protectedProcedure.input(resourceInput).handler(({ context, input }) => handle(() => service.saveBookableResource(context.db, actor(context), input, context.correlationId))),
  saveClosure: protectedProcedure.input(z.object({ day: scheduleDate, label: z.string().trim().min(1).max(120), closed: z.boolean() })).handler(({ context, input }) => handle(() => service.saveLeaveClosure(context.db, actor(context), input, context.correlationId))),
  requestLeave: protectedProcedure.input(leaveInput).handler(({ context, input }) => handle(() => service.createLeaveBooking(context.db, actor(context), input, context.correlationId))),
  reserve: protectedProcedure.input(reservationInput).handler(({ context, input }) => handle(() => service.createResourceBooking(context.db, actor(context), input, context.correlationId))),
  editLeave: protectedProcedure.input(editLeaveInput).output(z.object({ id: z.string().uuid(), version: z.number().int().positive() })).handler(({ context, input }) => handle(() => service.editLeaveBooking(context.db, actor(context), input, context.correlationId))),
  editReservation: protectedProcedure.input(editReservationInput).output(z.object({ id: z.string().uuid(), version: z.number().int().positive() })).handler(({ context, input }) => handle(() => service.editResourceBooking(context.db, actor(context), input, context.correlationId))),
  decide: protectedProcedure.input(decisionInput).handler(({ context, input }) => handle(() => service.decideBooking(context.db, actor(context), input, context.correlationId))),
  requests: protectedProcedure.input(z.object({ kind: z.enum(["leave", "resource"]), page: z.number().int().min(1).max(100000), scope: z.enum(["mine", "all"]) })).handler(({ context, input }) => handle(() => service.listScheduleRequests(context.db, actor(context), input))),
  resourceAvailability: protectedProcedure.input(availabilityInput).handler(({ context, input }) => handle(() => service.resourceAvailability(context.db, actor(context), input))),
  leaveAvailability: protectedProcedure.input(availabilityInput).handler(({ context, input }) => handle(() => service.leaveAvailability(context.db, actor(context), input))),
  publicResources: publicProcedure.input(pageInput).output(z.object({ items: z.array(publicResource).max(25), hasMore: z.boolean() })).handler(({ context, input }) => handle(() => service.listBookableResources(context.db, null, input))),
  publicResourceAvailability: publicProcedure.input(availabilityInput).output(publicResourceCalendar).handler(({ context, input }) => handle(() => service.resourceAvailability(context.db, null, input))),
  publicLeaveCalendar: publicProcedure.input(availabilityInput).output(publicLeaveCalendar).handler(({ context, input }) => handle(() => service.leaveAvailability(context.db, null, input))),
};
