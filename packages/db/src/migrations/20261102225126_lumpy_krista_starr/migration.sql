CREATE TABLE "custodial_report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"family" "custodial_form_family" NOT NULL,
	"count_id" uuid,
	"item_id" uuid,
	"profile_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"fund_cluster" text NOT NULL,
	"office" text,
	"payload" jsonb NOT NULL,
	"data_hash" text NOT NULL,
	"checksum" text NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL,
	"artifact_base64" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_report_export_scope" CHECK (("family" = 'stock_card' AND "item_id" IS NOT NULL AND "count_id" IS NULL) OR ("family" IN ('rpcsp', 'rpcppe') AND "count_id" IS NOT NULL AND "item_id" IS NULL)),
	CONSTRAINT "custodial_report_export_hashes" CHECK ("data_hash" ~ '^[0-9a-f]{64}$' AND "checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "custodial_report_export_row_count" CHECK ("row_count" >= 0),
	CONSTRAINT "custodial_report_export_size" CHECK ("artifact_base64" IS NULL OR length("artifact_base64") <= 22369624)
);
--> statement-breakpoint
CREATE INDEX "custodial_report_exports_created_idx" ON "custodial_report_exports" ("created_at","id");--> statement-breakpoint
ALTER TABLE "custodial_report_exports" ADD CONSTRAINT "custodial_report_exports_count_id_custodial_counts_id_fkey" FOREIGN KEY ("count_id") REFERENCES "custodial_counts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_report_exports" ADD CONSTRAINT "custodial_report_exports_item_id_custodial_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "custodial_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_report_exports" ADD CONSTRAINT "custodial_report_exports_7jsYtmQhCElQ_fkey" FOREIGN KEY ("profile_id") REFERENCES "custodial_form_profiles"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_report_exports" ADD CONSTRAINT "custodial_report_exports_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_report_exports" ADD CONSTRAINT "custodial_report_exports_profile_family_fk" FOREIGN KEY ("profile_id","family") REFERENCES "custodial_form_profiles"("id","family") ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION custodial_report_export_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Report export history is immutable'; END IF;
  IF OLD.artifact_base64 IS NULL OR NEW.artifact_base64 IS NOT NULL OR (NEW.id, NEW.family, NEW.count_id, NEW.item_id, NEW.profile_id, NEW.as_of_date, NEW.fund_cluster, NEW.office, NEW.payload, NEW.data_hash, NEW.checksum, NEW.filename, NEW.row_count, NEW.expires_at, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.family, OLD.count_id, OLD.item_id, OLD.profile_id, OLD.as_of_date, OLD.fund_cluster, OLD.office, OLD.payload, OLD.data_hash, OLD.checksum, OLD.filename, OLD.row_count, OLD.expires_at, OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'Report export history is immutable'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER custodial_report_export_immutable_trigger BEFORE UPDATE OR DELETE ON custodial_report_exports FOR EACH ROW EXECUTE FUNCTION custodial_report_export_immutable();
