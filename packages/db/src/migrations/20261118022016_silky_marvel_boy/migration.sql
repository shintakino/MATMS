CREATE TABLE "custodial_equipment_serial_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"unit_id" uuid NOT NULL,
	"normalized_brand" text NOT NULL,
	"normalized_serial" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_serial_reservation_normalized" CHECK (length(trim("normalized_brand")) > 0 AND "normalized_brand" = upper(trim("normalized_brand")) AND length(trim("normalized_serial")) > 0 AND "normalized_serial" = upper(trim("normalized_serial")))
);
--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD COLUMN "corrected_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD COLUMN "issue_details" jsonb;--> statement-breakpoint
CREATE INDEX "equipment_issue_correction_idx" ON "custodial_equipment_events" ("corrected_issue_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_serial_reservation_unique" ON "custodial_equipment_serial_reservations" ("normalized_brand","normalized_serial");--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD CONSTRAINT "custodial_equipment_events_cjnn95Gr9Stg_fkey" FOREIGN KEY ("corrected_issue_id") REFERENCES "custodial_transactions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_serial_reservations" ADD CONSTRAINT "custodial_equipment_serial_reservations_LUrBi4dtYWYD_fkey" FOREIGN KEY ("unit_id") REFERENCES "custodial_equipment_units"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD CONSTRAINT "equipment_issue_correction" CHECK (("kind" = 'correct_issue') = ("corrected_issue_id" IS NOT NULL AND "issue_details" IS NOT NULL) AND ("kind" = 'correct_issue' OR ("corrected_issue_id" IS NULL AND "issue_details" IS NULL)) AND ("kind" <> 'correct_issue' OR "transaction_id" IS NULL));--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" DROP CONSTRAINT "equipment_event_kind", ADD CONSTRAINT "equipment_event_kind" CHECK ("kind" IN ('register','adopt','issue','return','reassign','edit','correct_issue','repair','repaired','lost','recover','dispose'));
--> statement-breakpoint
ALTER TABLE custodial_equipment_serial_reservations ALTER CONSTRAINT "custodial_equipment_serial_reservations_LUrBi4dtYWYD_fkey" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Existing event fields and device heads remain unchanged.
INSERT INTO custodial_equipment_serial_reservations(unit_id,normalized_brand,normalized_serial)
SELECT DISTINCT unit_id,upper(trim(snapshot->>'brand')),upper(trim(snapshot->>'serialNumber'))
FROM custodial_equipment_events WHERE snapshot->>'serialNumber' IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_equipment_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Equipment history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.lot_id,NEW.balance_id,NEW.permanent_number,NEW.normalized_number,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.lot_id,OLD.balance_id,OLD.permanent_number,OLD.normalized_number,OLD.created_by,OLD.created_at)
      OR NEW.version<>OLD.version+1 OR NEW.effective_date<OLD.effective_date OR OLD.state='disposed' THEN
      RAISE EXCEPTION 'Equipment identity is immutable; custody must advance in date and version';
    END IF;
  ELSIF NEW.version<>0 THEN RAISE EXCEPTION 'Equipment registration starts at version zero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodial_lots l JOIN custodial_balances b ON b.lot_id=l.id AND b.item_id=l.item_id AND b.fund_cluster=l.fund_cluster WHERE l.id=NEW.lot_id AND b.id=NEW.balance_id AND l.reporting_class<>'stock_card' AND l.property_number=NEW.permanent_number) THEN
    RAISE EXCEPTION 'Equipment must match its acquisition lot and holding balance';
  END IF;
  IF NEW.normalized_serial IS NOT NULL THEN
    INSERT INTO custodial_equipment_serial_reservations(unit_id,normalized_brand,normalized_serial)
      VALUES (NEW.id,NEW.normalized_brand,NEW.normalized_serial) ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM custodial_equipment_serial_reservations r WHERE r.unit_id=NEW.id AND r.normalized_brand=NEW.normalized_brand AND r.normalized_serial=NEW.normalized_serial) THEN
      RAISE EXCEPTION 'Brand/serial is reserved for another device' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION protect_equipment_serial_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Equipment serial reservations are permanent'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER equipment_serial_reservation_protected BEFORE UPDATE OR DELETE ON custodial_equipment_serial_reservations FOR EACH ROW EXECUTE FUNCTION protect_equipment_serial_reservation();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_equipment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u custodial_equipment_units; prior custodial_equipment_events; source custodial_equipment_events;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Equipment events are immutable'; END IF;
  SELECT * INTO u FROM custodial_equipment_units WHERE id=NEW.unit_id;
  IF u.id IS NULL OR NEW.version<>u.version OR NEW.effective_date<>u.effective_date
    OR (NEW.snapshot->>'version')::integer IS DISTINCT FROM u.version
    OR NEW.snapshot->>'permanentNumber' IS DISTINCT FROM u.permanent_number
    OR NEW.snapshot->>'brand' IS DISTINCT FROM u.brand
    OR NEW.snapshot->>'model' IS DISTINCT FROM u.model
    OR NEW.snapshot->>'missingSerialReason' IS DISTINCT FROM u.missing_serial_reason
    OR NEW.snapshot->>'personName' IS DISTINCT FROM u.person_name
    OR NEW.snapshot->>'condition' IS DISTINCT FROM u.condition
    OR NEW.snapshot->>'specifications' IS DISTINCT FROM u.specifications
    OR NEW.snapshot->>'accessories' IS DISTINCT FROM u.accessories
    OR NEW.snapshot->>'warrantyUntil' IS DISTINCT FROM u.warranty_until::text
    OR NEW.snapshot->>'notes' IS DISTINCT FROM u.notes
    OR NEW.snapshot->>'serialNumber' IS DISTINCT FROM u.serial_number
    OR NEW.snapshot->>'state' IS DISTINCT FROM u.state
    OR NEW.snapshot->>'personId' IS DISTINCT FROM u.person_id::text
    OR NEW.snapshot->>'location' IS DISTINCT FROM u.location THEN
    RAISE EXCEPTION 'Equipment event must freeze the current custody state';
  END IF;
  IF NEW.kind IN ('issue','reassign','adopt') AND (NEW.transaction_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM custodial_transactions ct JOIN custodial_operations co ON co.id=ct.operation_id
    WHERE ct.id=NEW.transaction_id AND ct.balance_id=u.balance_id AND ct.delta=-1 AND co.operation_type='issue'
  )) THEN RAISE EXCEPTION 'Equipment issue requires its actual stock issue'; END IF;
  SELECT * INTO prior FROM custodial_equipment_events WHERE unit_id=u.id AND version=u.version-1;
  IF prior.id IS NOT NULL AND NEW.kind<>'edit' AND
    (NEW.snapshot - ARRAY['state','personId','personName','location','condition','version']) IS DISTINCT FROM
    (prior.snapshot - ARRAY['state','personId','personName','location','condition','version']) THEN
    RAISE EXCEPTION 'Manufacturer identity and details require an audited edit event';
  END IF;
  IF NEW.kind='edit' AND (NEW.snapshot->'state',NEW.snapshot->'personId',NEW.snapshot->'personName') IS DISTINCT FROM (prior.snapshot->'state',prior.snapshot->'personId',prior.snapshot->'personName') THEN
    RAISE EXCEPTION 'Device detail edits cannot change custody';
  END IF;
  IF NEW.kind='correct_issue' THEN
    SELECT * INTO source FROM custodial_equipment_events WHERE unit_id=u.id AND kind IN ('issue','reassign','adopt') ORDER BY version DESC LIMIT 1;
    IF source.id IS NULL OR source.transaction_id IS DISTINCT FROM NEW.corrected_issue_id
      OR u.state<>'issued' OR prior.snapshot->>'state'<>'issued'
      OR NEW.issue_details->>'date' IS NULL OR NEW.issue_details->>'reference' IS NULL OR NEW.issue_details->>'purpose' IS NULL
      OR length(trim(NEW.issue_details->>'reference'))=0 OR length(trim(NEW.issue_details->>'purpose'))=0
      OR (NEW.issue_details->>'date')::date > NEW.effective_date THEN
      RAISE EXCEPTION 'Issue correction must annotate the outstanding issued device';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
