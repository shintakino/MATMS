CREATE TABLE "custodial_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_hash" text NOT NULL,
	"filename" text NOT NULL,
	"family" "custodial_form_family" NOT NULL,
	"raw_base64" text,
	"expires_at" timestamp with time zone NOT NULL,
	"warnings" jsonb NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_import_source_hash" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "custodial_import_raw_limit" CHECK ("raw_base64" IS NULL OR length("raw_base64") <= 11184812),
	CONSTRAINT "custodial_import_status" CHECK ("status" IN ('staged', 'committed', 'expired')),
	CONSTRAINT "custodial_import_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"batch_id" uuid NOT NULL,
	"sheet_name" text NOT NULL,
	"source_row" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"mapping" jsonb,
	"resolution" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custodial_import_source_row_positive" CHECK ("source_row" > 0),
	CONSTRAINT "custodial_import_row_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE INDEX "custodial_import_batches_hash_idx" ON "custodial_import_batches" ("source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_import_source_row_unique" ON "custodial_import_rows" ("batch_id","sheet_name","source_row");--> statement-breakpoint
ALTER TABLE "custodial_import_batches" ADD CONSTRAINT "custodial_import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_import_rows" ADD CONSTRAINT "custodial_import_rows_batch_id_custodial_import_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "custodial_import_batches"("id") ON DELETE RESTRICT;