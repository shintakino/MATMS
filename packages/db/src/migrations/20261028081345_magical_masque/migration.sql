CREATE TABLE "custodial_count_omissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"count_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"source_fingerprint" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_count_omission_reason_nonblank" CHECK (length(trim("reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_count_omission_unique" ON "custodial_count_omissions" ("count_id","lot_id");--> statement-breakpoint
ALTER TABLE "custodial_count_omissions" ADD CONSTRAINT "custodial_count_omissions_count_id_custodial_counts_id_fkey" FOREIGN KEY ("count_id") REFERENCES "custodial_counts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_omissions" ADD CONSTRAINT "custodial_count_omissions_lot_id_custodial_lots_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "custodial_lots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_omissions" ADD CONSTRAINT "custodial_count_omissions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE TRIGGER custodial_count_omission_frozen_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON custodial_count_omissions FOR EACH ROW EXECUTE FUNCTION custodial_count_child_frozen_guard();
