CREATE TYPE "custodial_count_line_status" AS ENUM('uncounted', 'counted', 'excluded', 'unavailable');--> statement-breakpoint
CREATE TYPE "custodial_count_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE "custodial_count_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"count_id" uuid NOT NULL,
	"line_id" uuid,
	"user_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custodial_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"count_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"status" "custodial_count_line_status" DEFAULT 'uncounted'::"custodial_count_line_status" NOT NULL,
	"physical_quantity" integer,
	"condition" text,
	"remarks" text,
	"resolution" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custodial_count_lines_quantity" CHECK (("status" = 'counted' AND "physical_quantity" IS NOT NULL AND "physical_quantity" >= 0) OR ("status" <> 'counted' AND "physical_quantity" IS NULL)),
	CONSTRAINT "custodial_count_lines_resolution" CHECK ("status" NOT IN ('excluded', 'unavailable') OR ("resolution" IS NOT NULL AND length(trim("resolution")) > 0)),
	CONSTRAINT "custodial_count_lines_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"family" "custodial_form_family" NOT NULL,
	"profile_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"fund_cluster" text NOT NULL,
	"office" text,
	"metadata" jsonb NOT NULL,
	"status" "custodial_count_status" DEFAULT 'draft'::"custodial_count_status" NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_by" text,
	"finalized_at" timestamp with time zone,
	"final_payload" jsonb,
	"supersedes_id" uuid,
	"amendment_reason" text,
	CONSTRAINT "custodial_counts_family" CHECK ("family" IN ('rpcsp', 'rpcppe')),
	CONSTRAINT "custodial_counts_version" CHECK ("version" >= 0),
	CONSTRAINT "custodial_counts_finalization" CHECK (("status" = 'draft' AND "finalized_by" IS NULL AND "finalized_at" IS NULL AND "final_payload" IS NULL) OR ("status" = 'finalized' AND "finalized_by" IS NOT NULL AND "finalized_at" IS NOT NULL AND "final_payload" IS NOT NULL)),
	CONSTRAINT "custodial_counts_amendment" CHECK (("supersedes_id" IS NULL AND "amendment_reason" IS NULL) OR ("supersedes_id" IS NOT NULL AND "amendment_reason" IS NOT NULL AND length(trim("amendment_reason")) > 0 AND "supersedes_id" <> "id"))
);
--> statement-breakpoint
CREATE INDEX "custodial_count_assignments_scope_idx" ON "custodial_count_assignments" ("count_id","user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_count_assignments_session_unique" ON "custodial_count_assignments" ("count_id","user_id") WHERE "line_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_count_assignments_line_unique" ON "custodial_count_assignments" ("count_id","line_id","user_id") WHERE "line_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_count_lines_count_lot_unique" ON "custodial_count_lines" ("count_id","lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_count_lines_id_count_unique" ON "custodial_count_lines" ("id","count_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_counts_code_unique" ON "custodial_counts" ("normalized_code");--> statement-breakpoint
ALTER TABLE "custodial_count_assignments" ADD CONSTRAINT "custodial_count_assignments_count_id_custodial_counts_id_fkey" FOREIGN KEY ("count_id") REFERENCES "custodial_counts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_assignments" ADD CONSTRAINT "custodial_count_assignments_NCcBPyQSf7Pb_fkey" FOREIGN KEY ("line_id") REFERENCES "custodial_count_lines"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_assignments" ADD CONSTRAINT "custodial_count_assignments_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_assignments" ADD CONSTRAINT "custodial_count_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_assignments" ADD CONSTRAINT "custodial_count_assignment_line_scope_fk" FOREIGN KEY ("line_id","count_id") REFERENCES "custodial_count_lines"("id","count_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_lines" ADD CONSTRAINT "custodial_count_lines_count_id_custodial_counts_id_fkey" FOREIGN KEY ("count_id") REFERENCES "custodial_counts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_lines" ADD CONSTRAINT "custodial_count_lines_lot_id_custodial_lots_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "custodial_lots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_counts" ADD CONSTRAINT "custodial_counts_profile_id_custodial_form_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "custodial_form_profiles"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_counts" ADD CONSTRAINT "custodial_counts_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_counts" ADD CONSTRAINT "custodial_counts_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_counts" ADD CONSTRAINT "custodial_counts_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "custodial_counts"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION custodial_count_frozen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'Finalized count is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER custodial_count_frozen_guard_trigger BEFORE UPDATE OR DELETE ON custodial_counts FOR EACH ROW EXECUTE FUNCTION custodial_count_frozen_guard();--> statement-breakpoint
CREATE FUNCTION custodial_count_child_frozen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status custodial_count_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.count_id <> OLD.count_id THEN RAISE EXCEPTION 'Count membership cannot be changed'; END IF;
  IF TG_OP = 'DELETE' THEN parent_id := OLD.count_id; ELSE parent_id := NEW.count_id; END IF;
  SELECT status INTO parent_status FROM custodial_counts WHERE id = parent_id FOR SHARE;
  IF parent_status = 'finalized' THEN RAISE EXCEPTION 'Finalized count is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER custodial_count_line_frozen_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON custodial_count_lines FOR EACH ROW EXECUTE FUNCTION custodial_count_child_frozen_guard();--> statement-breakpoint
CREATE TRIGGER custodial_count_assignment_frozen_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON custodial_count_assignments FOR EACH ROW EXECUTE FUNCTION custodial_count_child_frozen_guard();
