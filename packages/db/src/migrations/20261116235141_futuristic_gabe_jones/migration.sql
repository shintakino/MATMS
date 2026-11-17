CREATE TABLE "custodial_equipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"unit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"transaction_id" uuid,
	"effective_date" date NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"document_reference" text,
	"snapshot" jsonb NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_event_kind" CHECK ("kind" IN ('register','adopt','issue','return','reassign','edit','repair','repaired','lost','recover','dispose')),
	CONSTRAINT "equipment_event_reference" CHECK (length(trim("reference")) > 0 AND length(trim("reason")) > 0),
	CONSTRAINT "equipment_event_version" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_equipment_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"lot_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"permanent_number" text NOT NULL,
	"normalized_number" text NOT NULL,
	"brand" text NOT NULL,
	"normalized_brand" text NOT NULL,
	"model" text NOT NULL,
	"serial_number" text,
	"normalized_serial" text,
	"missing_serial_reason" text,
	"specifications" text DEFAULT '' NOT NULL,
	"accessories" text DEFAULT '' NOT NULL,
	"warranty_until" date,
	"notes" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'available' NOT NULL,
	"person_id" uuid,
	"person_name" text,
	"location" text NOT NULL,
	"condition" text NOT NULL,
	"effective_date" date NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_version" CHECK ("version" >= 0),
	CONSTRAINT "equipment_state" CHECK ("state" IN ('available','issued','under_repair','lost','disposed')),
	CONSTRAINT "equipment_person" CHECK (("person_id" IS NULL) = ("person_name" IS NULL) AND ("state" <> 'issued' OR "person_id" IS NOT NULL) AND ("state" NOT IN ('available','disposed') OR "person_id" IS NULL)),
	CONSTRAINT "equipment_identity" CHECK (length(trim("permanent_number")) > 0 AND "normalized_number" = upper(trim("permanent_number")) AND length(trim("brand")) > 0 AND "normalized_brand" = upper(trim("brand")) AND length(trim("model")) > 0),
	CONSTRAINT "equipment_serial" CHECK (("serial_number" IS NOT NULL AND length(trim("serial_number")) > 0 AND "normalized_serial" IS NOT NULL AND "normalized_serial" = upper(trim("serial_number")) AND "missing_serial_reason" IS NULL) OR ("serial_number" IS NULL AND "normalized_serial" IS NULL AND "missing_serial_reason" IS NOT NULL AND length(trim("missing_serial_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_event_version_unique" ON "custodial_equipment_events" ("unit_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_event_transaction_unique" ON "custodial_equipment_events" ("transaction_id") WHERE "transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "equipment_event_as_of_idx" ON "custodial_equipment_events" ("unit_id","effective_date","version");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_lot_unique" ON "custodial_equipment_units" ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_number_unique" ON "custodial_equipment_units" ("normalized_number");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_serial_unique" ON "custodial_equipment_units" ("normalized_brand","normalized_serial") WHERE "normalized_serial" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "equipment_person_idx" ON "custodial_equipment_units" ("person_id","state");--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD CONSTRAINT "custodial_equipment_events_LdJ4SlpRejyA_fkey" FOREIGN KEY ("unit_id") REFERENCES "custodial_equipment_units"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD CONSTRAINT "custodial_equipment_events_f01meFntaxtP_fkey" FOREIGN KEY ("transaction_id") REFERENCES "custodial_transactions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_events" ADD CONSTRAINT "custodial_equipment_events_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_units" ADD CONSTRAINT "custodial_equipment_units_lot_id_custodial_lots_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "custodial_lots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_units" ADD CONSTRAINT "custodial_equipment_units_balance_id_custodial_balances_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "custodial_balances"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_units" ADD CONSTRAINT "custodial_equipment_units_person_id_scheduling_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "scheduling_people"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_equipment_units" ADD CONSTRAINT "custodial_equipment_units_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
-- No backfill: registration is an explicit reviewed workflow, not stock creation.
CREATE FUNCTION protect_equipment_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Equipment history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.lot_id,NEW.balance_id,NEW.permanent_number,NEW.normalized_number,NEW.brand,NEW.normalized_brand,NEW.serial_number,NEW.normalized_serial,NEW.missing_serial_reason,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.lot_id,OLD.balance_id,OLD.permanent_number,OLD.normalized_number,OLD.brand,OLD.normalized_brand,OLD.serial_number,OLD.normalized_serial,OLD.missing_serial_reason,OLD.created_by,OLD.created_at)
      OR NEW.version<>OLD.version+1 OR NEW.effective_date<OLD.effective_date OR OLD.state='disposed' THEN
      RAISE EXCEPTION 'Equipment identity is immutable; custody must advance in date and version';
    END IF;
  ELSIF NEW.version<>0 THEN RAISE EXCEPTION 'Equipment registration starts at version zero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM custodial_lots l JOIN custodial_balances b ON b.lot_id=l.id AND b.item_id=l.item_id AND b.fund_cluster=l.fund_cluster WHERE l.id=NEW.lot_id AND b.id=NEW.balance_id AND l.reporting_class<>'stock_card' AND l.property_number=NEW.permanent_number) THEN
    RAISE EXCEPTION 'Equipment must match its acquisition lot and holding balance';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER equipment_head_protected BEFORE INSERT OR UPDATE OR DELETE ON custodial_equipment_units FOR EACH ROW EXECUTE FUNCTION protect_equipment_head();
--> statement-breakpoint
CREATE FUNCTION protect_equipment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u custodial_equipment_units;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Equipment events are immutable'; END IF;
  SELECT * INTO u FROM custodial_equipment_units WHERE id=NEW.unit_id;
  IF u.id IS NULL OR NEW.version<>u.version OR NEW.effective_date<>u.effective_date
    OR (NEW.snapshot->>'version')::integer IS DISTINCT FROM u.version
    OR NEW.snapshot->>'permanentNumber' IS DISTINCT FROM u.permanent_number
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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER equipment_event_protected BEFORE INSERT OR UPDATE OR DELETE ON custodial_equipment_events FOR EACH ROW EXECUTE FUNCTION protect_equipment_event();
--> statement-breakpoint
CREATE FUNCTION check_equipment_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u custodial_equipment_units; target_lot uuid; expected integer; held integer; other integer;
BEGIN
  IF TG_TABLE_NAME='custodial_equipment_units' THEN target_lot=NEW.lot_id; ELSE target_lot=NEW.lot_id; END IF;
  SELECT * INTO u FROM custodial_equipment_units WHERE lot_id=target_lot;
  IF u.id IS NULL THEN RETURN NEW; END IF;
  expected=CASE WHEN u.state IN ('available','under_repair') AND u.person_id IS NULL THEN 1 ELSE 0 END;
  SELECT quantity INTO held FROM custodial_balances WHERE id=u.balance_id;
  SELECT coalesce(sum(quantity),0) INTO other FROM custodial_balances WHERE lot_id=u.lot_id AND id<>u.balance_id;
  IF held IS DISTINCT FROM expected OR other<>0 THEN RAISE EXCEPTION 'Equipment custody and holding stock disagree'; END IF;
  IF NOT EXISTS (SELECT 1 FROM custodial_equipment_events e WHERE e.unit_id=u.id AND e.version=u.version) THEN
    RAISE EXCEPTION 'Equipment requires an immutable current event';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER equipment_state_consistent AFTER INSERT OR UPDATE ON custodial_equipment_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_state();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER equipment_balance_consistent AFTER INSERT OR UPDATE ON custodial_balances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_equipment_state();
