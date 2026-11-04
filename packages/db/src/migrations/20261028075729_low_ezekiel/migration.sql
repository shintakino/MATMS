ALTER TABLE "custodial_count_lines" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "custodial_count_lines" ADD COLUMN "import_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "custodial_count_lines" ADD CONSTRAINT "custodial_count_lines_q8P7v6RYhOoJ_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "custodial_import_batches"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_count_lines" ADD CONSTRAINT "custodial_count_lines_import_evidence" CHECK (("import_batch_id" IS NULL AND "import_evidence" IS NULL) OR ("import_batch_id" IS NOT NULL AND "import_evidence" IS NOT NULL));--> statement-breakpoint
CREATE FUNCTION custodial_import_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'committed' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
    IF OLD.raw_base64 IS NULL OR NEW.raw_base64 IS NOT NULL OR NEW.version <> OLD.version + 1 OR (NEW.id, NEW.source_hash, NEW.filename, NEW.family, NEW.classification_threshold, NEW.expires_at, NEW.warnings, NEW.status, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.source_hash, OLD.filename, OLD.family, OLD.classification_threshold, OLD.expires_at, OLD.warnings, OLD.status, OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER custodial_import_batch_immutable_trigger BEFORE UPDATE OR DELETE ON custodial_import_batches FOR EACH ROW EXECUTE FUNCTION custodial_import_batch_immutable();--> statement-breakpoint
CREATE FUNCTION custodial_import_row_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.batch_id <> OLD.batch_id THEN RAISE EXCEPTION 'Import row membership cannot change'; END IF;
  IF TG_OP = 'DELETE' THEN parent_id := OLD.batch_id; ELSE parent_id := NEW.batch_id; END IF;
  SELECT status INTO parent_status FROM custodial_import_batches WHERE id = parent_id FOR SHARE;
  IF parent_status = 'committed' THEN RAISE EXCEPTION 'Committed import rows are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER custodial_import_row_immutable_trigger BEFORE INSERT OR UPDATE OR DELETE ON custodial_import_rows FOR EACH ROW EXECUTE FUNCTION custodial_import_row_immutable();
