CREATE TYPE "custodial_form_family" AS ENUM('stock_card', 'rpcsp', 'rpcppe');--> statement-breakpoint
CREATE TABLE "custodial_form_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"family" "custodial_form_family" NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"source_hash" text NOT NULL,
	"version_note" text NOT NULL,
	"visual_approval" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_form_profile_version_positive" CHECK ("version" > 0),
	CONSTRAINT "custodial_form_profile_source_hash" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "custodial_form_profile_notes_nonblank" CHECK (length(trim("version_note")) > 0 AND length(trim("visual_approval")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_form_profile_family_version_unique" ON "custodial_form_profiles" ("family","version");--> statement-breakpoint
ALTER TABLE "custodial_form_profiles" ADD CONSTRAINT "custodial_form_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE FUNCTION custodial_form_profile_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Form profile versions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER custodial_form_profile_immutable_trigger BEFORE UPDATE OR DELETE ON custodial_form_profiles FOR EACH ROW EXECUTE FUNCTION custodial_form_profile_immutable();
