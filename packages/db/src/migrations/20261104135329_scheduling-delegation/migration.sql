ALTER TYPE "employment_category" ADD VALUE 'shs';--> statement-breakpoint
ALTER TYPE "employment_category" ADD VALUE 'jhs';--> statement-breakpoint
CREATE TABLE "scheduling_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"person_id" uuid,
	"person_version" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_operation_id" uuid,
	"used_fingerprint" text,
	"receipt_code" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scheduling_invitation_kind" CHECK (("kind" = 'leave' AND "person_id" IS NOT NULL AND "person_version" IS NOT NULL) OR ("kind" = 'resource' AND "person_id" IS NULL AND "person_version" IS NULL)),
	CONSTRAINT "scheduling_invitation_expiry" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '7 days'),
	CONSTRAINT "scheduling_invitation_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "scheduling_invitation_receipt" CHECK (num_nonnulls("used_at", "used_operation_id", "used_fingerprint", "receipt_code") IN (0, 4)),
	CONSTRAINT "scheduling_invitation_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduling_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"user_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scheduling_person_code" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
	CONSTRAINT "scheduling_person_name" CHECK (length(trim("name")) BETWEEN 1 AND 160),
	CONSTRAINT "scheduling_person_category" CHECK ("category" IN ('teacher', 'shs', 'jhs', 'personnel')),
	CONSTRAINT "scheduling_teacher_no_account" CHECK ("category" = 'personnel' OR "user_id" IS NULL),
	CONSTRAINT "scheduling_person_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scheduling_public_limits" (
	"key" text PRIMARY KEY,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "scheduling_public_limit_positive" CHECK ("attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD COLUMN "person_name" text;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "person_name" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "beneficiary_category" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduling_policy" ADD COLUMN "shs_limit" integer;--> statement-breakpoint
ALTER TABLE "scheduling_policy" ADD COLUMN "jhs_limit" integer;--> statement-breakpoint
-- Preserve existing beneficiaries without assigning an unknown teacher division.
CREATE TEMP TABLE matms_scheduling_person_backfill ON COMMIT DROP AS
SELECT u.id AS old_user_id, gen_random_uuid() AS person_id,
       'MIG-' || row_number() OVER (ORDER BY u.id) AS code, u.name,
       COALESCE(e.category::text, (SELECT l.category::text FROM leave_bookings l WHERE l.requester_id = u.id ORDER BY l.created_at DESC, l.id LIMIT 1)) AS category,
       COALESCE(e.active, true) AS active
FROM "user" u LEFT JOIN employment_assignments e ON e.user_id = u.id
WHERE e.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM leave_bookings l WHERE l.requester_id = u.id);
--> statement-breakpoint
INSERT INTO scheduling_people (id, code, name, category, user_id, active)
SELECT person_id, code, name, category, CASE WHEN category = 'personnel' THEN old_user_id ELSE NULL END, active
FROM matms_scheduling_person_backfill;
--> statement-breakpoint
UPDATE leave_bookings l SET person_id = p.person_id, person_name = p.name
FROM matms_scheduling_person_backfill p WHERE p.old_user_id = l.requester_id;
--> statement-breakpoint
UPDATE resource_bookings b SET person_name = u.name, person_id = p.person_id, beneficiary_category = COALESCE(p.category, 'other')
FROM "user" u LEFT JOIN matms_scheduling_person_backfill p ON p.old_user_id = u.id WHERE b.requester_id = u.id;
--> statement-breakpoint
ALTER TABLE leave_bookings ALTER COLUMN person_id SET NOT NULL, ALTER COLUMN person_name SET NOT NULL;
--> statement-breakpoint
ALTER TABLE resource_bookings ALTER COLUMN person_name SET NOT NULL, ALTER COLUMN beneficiary_category SET NOT NULL;
--> statement-breakpoint
-- The beneficiary, rather than the filing account, owns overlapping leave dates.
ALTER TABLE leave_bookings DROP CONSTRAINT leave_booking_person_no_overlap;
--> statement-breakpoint
ALTER TABLE leave_bookings ADD CONSTRAINT leave_booking_person_no_overlap
  EXCLUDE USING gist (person_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('pending', 'approved'));
--> statement-breakpoint
ALTER TABLE "leave_bookings" ALTER COLUMN "requester_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_bookings" ALTER COLUMN "requester_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_booking_invitation_unique" ON "leave_bookings" ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_booking_invitation_unique" ON "resource_bookings" ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_invitation_hash_unique" ON "scheduling_invitations" ("token_hash");--> statement-breakpoint
CREATE INDEX "scheduling_invitation_created_idx" ON "scheduling_invitations" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_person_code_unique" ON "scheduling_people" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_person_account_unique" ON "scheduling_people" ("user_id");--> statement-breakpoint
CREATE INDEX "scheduling_public_limit_window_idx" ON "scheduling_public_limits" ("window_start");--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_bookings_person_id_scheduling_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "scheduling_people"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_bookings_invitation_id_scheduling_invitations_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "scheduling_invitations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_person_id_scheduling_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "scheduling_people"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_invitation_id_scheduling_invitations_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "scheduling_invitations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling_invitations" ADD CONSTRAINT "scheduling_invitations_person_id_scheduling_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "scheduling_people"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling_invitations" ADD CONSTRAINT "scheduling_invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling_people" ADD CONSTRAINT "scheduling_people_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_booking_origin" CHECK (num_nonnulls("requester_id", "invitation_id") = 1);--> statement-breakpoint
ALTER TABLE "leave_bookings" ADD CONSTRAINT "leave_booking_beneficiary_name" CHECK (length(trim("person_name")) > 0);--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_booking_origin" CHECK (num_nonnulls("requester_id", "invitation_id") = 1);--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_booking_beneficiary_name" CHECK (length(trim("person_name")) > 0);--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_booking_beneficiary_category" CHECK ("beneficiary_category" IN ('teacher', 'shs', 'jhs', 'personnel', 'student', 'other'));--> statement-breakpoint
ALTER TABLE "scheduling_policy" DROP CONSTRAINT "scheduling_policy_limits", ADD CONSTRAINT "scheduling_policy_limits" CHECK (("teacher_limit" IS NULL OR "teacher_limit" >= 0) AND ("personnel_limit" IS NULL OR "personnel_limit" >= 0) AND ("shs_limit" IS NULL OR "shs_limit" >= 0) AND ("jhs_limit" IS NULL OR "jhs_limit" >= 0));