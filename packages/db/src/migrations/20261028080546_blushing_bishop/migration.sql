ALTER TABLE "custodial_import_batches" ADD COLUMN "commit_details" jsonb;--> statement-breakpoint
ALTER TABLE "custodial_import_batches" ADD CONSTRAINT "custodial_import_commit_details" CHECK (("status" = 'committed' AND "commit_details" IS NOT NULL) OR ("status" <> 'committed' AND "commit_details" IS NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION custodial_import_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'committed' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
    IF OLD.raw_base64 IS NULL OR NEW.raw_base64 IS NOT NULL OR NEW.version <> OLD.version + 1 OR (NEW.id, NEW.source_hash, NEW.filename, NEW.family, NEW.classification_threshold, NEW.expires_at, NEW.warnings, NEW.commit_details, NEW.status, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.source_hash, OLD.filename, OLD.family, OLD.classification_threshold, OLD.expires_at, OLD.warnings, OLD.commit_details, OLD.status, OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
