CREATE TYPE "bookable_kind" AS ENUM('equipment', 'facility');--> statement-breakpoint
CREATE TYPE "booking_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "employment_category" AS ENUM('teacher', 'personnel');--> statement-breakpoint
CREATE TABLE "bookable_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"kind" "bookable_kind" NOT NULL,
	"lot_id" uuid,
	"public_description" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bookable_resource_link" CHECK (("kind" = 'equipment' AND "lot_id" IS NOT NULL) OR ("kind" = 'facility' AND "lot_id" IS NULL)),
	CONSTRAINT "bookable_resource_name_nonempty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "employment_assignments" (
	"user_id" text PRIMARY KEY,
	"category" "employment_category" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"requester_id" text NOT NULL,
	"category" "employment_category" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" "booking_status" DEFAULT 'pending'::"booking_status" NOT NULL,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"operation_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_booking_dates" CHECK ("end_date" >= "start_date" AND "end_date" - "start_date" < 366),
	CONSTRAINT "leave_booking_reason" CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "leave_closures" (
	"day" date PRIMARY KEY,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"resource_id" uuid NOT NULL,
	"requester_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"purpose" text NOT NULL,
	"status" "booking_status" DEFAULT 'pending'::"booking_status" NOT NULL,
	"decision_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"operation_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_booking_interval" CHECK ("end_date" >= "start_date" AND "end_date" - "start_date" < 366),
	CONSTRAINT "resource_booking_purpose" CHECK (length(trim("purpose")) > 0)
);
--> statement-breakpoint
CREATE TABLE "scheduling_policy" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"leave_enabled" boolean DEFAULT false NOT NULL,
	"public_leave" boolean DEFAULT false NOT NULL,
	"teacher_limit" integer,
	"personnel_limit" integer,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scheduling_policy_singleton" CHECK ("id" = 1),
	CONSTRAINT "scheduling_policy_limits" CHECK (("teacher_limit" IS NULL OR "teacher_limit" >= 0) AND ("personnel_limit" IS NULL OR "personnel_limit" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bookable_resource_name_unique" ON "bookable_resources" ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_booking_operation_unique" ON "leave_bookings" ("operation_id");--> statement-breakpoint
CREATE INDEX "leave_booking_dates_idx" ON "leave_bookings" ("start_date","end_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_booking_operation_unique" ON "resource_bookings" ("operation_id");--> statement-breakpoint
CREATE INDEX "resource_booking_range_idx" ON "resource_bookings" ("resource_id","start_date","end_date","status");--> statement-breakpoint
ALTER TABLE "bookable_resources" ADD CONSTRAINT "bookable_resources_lot_id_custodial_lots_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "custodial_lots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_bookings_requester_id_user_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_bookings_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_resource_id_bookable_resources_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "bookable_resources"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_requester_id_user_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
-- Reviewed scheduling exclusion constraints complement the service's capacity lock.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE resource_bookings ADD CONSTRAINT resource_booking_no_overlap
  EXCLUDE USING gist (resource_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending', 'approved'));
--> statement-breakpoint
ALTER TABLE leave_bookings ADD CONSTRAINT leave_booking_person_no_overlap
  EXCLUDE USING gist (requester_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending', 'approved'));
