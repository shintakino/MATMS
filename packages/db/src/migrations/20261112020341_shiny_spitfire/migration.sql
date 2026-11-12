CREATE TABLE "custodial_ics_counters" (
	"period" text PRIMARY KEY,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custodial_ics_counter_period" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "custodial_ics_counter_nonnegative" CHECK ("last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_ics_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"number" text NOT NULL,
	"current_export_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_ics_document_version" CHECK ("version" > 0),
	CONSTRAINT "custodial_ics_deleted_actor" CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "custodial_ics_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_ics_revision_version" CHECK ("version" > 0)
);
--> statement-breakpoint
DROP INDEX "custodial_ics_number_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_ics_document_number_unique" ON "custodial_ics_documents" ("number");--> statement-breakpoint
CREATE INDEX "custodial_ics_number_idx" ON "custodial_ics_exports" ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_ics_document_revision_unique" ON "custodial_ics_versions" ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_ics_revision_export_unique" ON "custodial_ics_versions" ("export_id");--> statement-breakpoint
ALTER TABLE "custodial_ics_documents" ADD CONSTRAINT "custodial_ics_documents_UObzkA0nnZcl_fkey" FOREIGN KEY ("current_export_id") REFERENCES "custodial_ics_exports"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_ics_documents" ADD CONSTRAINT "custodial_ics_documents_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_ics_documents" ADD CONSTRAINT "custodial_ics_documents_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_ics_versions" ADD CONSTRAINT "custodial_ics_versions_pT8auOXbkdEo_fkey" FOREIGN KEY ("document_id") REFERENCES "custodial_ics_documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_ics_versions" ADD CONSTRAINT "custodial_ics_versions_export_id_custodial_ics_exports_id_fkey" FOREIGN KEY ("export_id") REFERENCES "custodial_ics_exports"("id") ON DELETE RESTRICT;--> statement-breakpoint
INSERT INTO custodial_ics_documents (id, number, current_export_id, version, created_by, created_at, updated_at)
SELECT id, number, id, 1, created_by, created_at, created_at FROM custodial_ics_exports;
--> statement-breakpoint
INSERT INTO custodial_ics_versions (document_id, export_id, version, reason, created_at)
SELECT id, id, 1, 'Original saved slip', created_at FROM custodial_ics_exports;
--> statement-breakpoint
INSERT INTO custodial_ics_counters (period, last_value)
SELECT split_part(n, '-', 1) || '-' || split_part(n, '-', 2), max(split_part(n, '-', 3)::integer)
FROM (SELECT regexp_replace(upper(number), '^ICS-', '') AS n FROM custodial_ics_documents) source
WHERE n ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{1,9}$'
GROUP BY split_part(n, '-', 1), split_part(n, '-', 2);
--> statement-breakpoint
CREATE TRIGGER custodial_ics_versions_immutable BEFORE UPDATE OR DELETE ON custodial_ics_versions
FOR EACH ROW EXECUTE FUNCTION reject_ics_snapshot_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_ics_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Use the ICS delete lifecycle'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.number <> OLD.number OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1) THEN
    RAISE EXCEPTION 'ICS identity is immutable and version must advance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodial_ics_exports e WHERE e.id=NEW.current_export_id AND e.number=NEW.number) THEN
    RAISE EXCEPTION 'ICS head must reference its numbered snapshot';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER custodial_ics_document_protected BEFORE INSERT OR UPDATE OR DELETE ON custodial_ics_documents
FOR EACH ROW EXECUTE FUNCTION protect_ics_document();
--> statement-breakpoint
CREATE FUNCTION check_ics_document_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custodial_ics_documents d JOIN custodial_ics_versions v ON v.document_id=d.id AND v.export_id=d.current_export_id WHERE d.id=NEW.id) THEN
    RAISE EXCEPTION 'ICS head requires an immutable revision link';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER custodial_ics_document_revision_link AFTER INSERT OR UPDATE ON custodial_ics_documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ics_document_revision();
