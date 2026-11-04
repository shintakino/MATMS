CREATE TABLE "custodial_classification_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"threshold" numeric(15,2) NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_classification_policy_version_positive" CHECK ("version" > 0),
	CONSTRAINT "custodial_classification_policy_threshold_nonnegative" CHECK ("threshold" >= 0),
	CONSTRAINT "custodial_classification_policy_note_nonblank" CHECK (length(trim("note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "custodial_import_batches" ADD COLUMN "classification_policy_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_classification_policy_version_unique" ON "custodial_classification_policies" ("version");--> statement-breakpoint
ALTER TABLE "custodial_classification_policies" ADD CONSTRAINT "custodial_classification_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_import_batches" ADD CONSTRAINT "custodial_import_batches_YnCWfIHIS2BW_fkey" FOREIGN KEY ("classification_policy_id") REFERENCES "custodial_classification_policies"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION custodial_classification_policy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Classification policy versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER custodial_classification_policy_immutable_trigger BEFORE UPDATE OR DELETE ON custodial_classification_policies FOR EACH ROW EXECUTE FUNCTION custodial_classification_policy_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION custodial_import_batch_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'committed' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
    IF OLD.raw_base64 IS NULL OR NEW.raw_base64 IS NOT NULL OR NEW.version <> OLD.version + 1 OR (NEW.id, NEW.source_hash, NEW.filename, NEW.family, NEW.classification_threshold, NEW.classification_policy_id, NEW.expires_at, NEW.warnings, NEW.commit_details, NEW.status, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.source_hash, OLD.filename, OLD.family, OLD.classification_threshold, OLD.classification_policy_id, OLD.expires_at, OLD.warnings, OLD.commit_details, OLD.status, OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'Committed import is immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
