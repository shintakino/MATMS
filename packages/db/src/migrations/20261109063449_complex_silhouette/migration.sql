CREATE TABLE "custodial_ics_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operation_id" uuid NOT NULL,
	"intent_hash" text NOT NULL,
	"number" text NOT NULL,
	"payload" jsonb NOT NULL,
	"data_hash" text NOT NULL,
	"checksum" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_ics_operation_unique" ON "custodial_ics_exports" ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_ics_number_unique" ON "custodial_ics_exports" ("number");--> statement-breakpoint
ALTER TABLE "custodial_ics_exports" ADD CONSTRAINT "custodial_ics_exports_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION reject_ics_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ICS snapshots are immutable'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER custodial_ics_immutable BEFORE UPDATE OR DELETE ON custodial_ics_exports
FOR EACH ROW EXECUTE FUNCTION reject_ics_snapshot_mutation();
