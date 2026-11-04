CREATE TYPE "custodial_class" AS ENUM('stock_card', 'semi_expendable', 'ppe');--> statement-breakpoint
CREATE TYPE "custodial_operation_type" AS ENUM('opening', 'receipt', 'issue', 'return', 'transfer', 'adjustment');--> statement-breakpoint
CREATE TABLE "custodial_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"fund_cluster" text NOT NULL,
	"office" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custodial_balances_quantity_nonnegative" CHECK ("quantity" >= 0),
	CONSTRAINT "custodial_balances_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"article" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"reorder_point" integer,
	"default_section_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_items_reorder_nonnegative" CHECK ("reorder_point" IS NULL OR "reorder_point" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"item_id" uuid NOT NULL,
	"reporting_class" "custodial_class" NOT NULL,
	"property_number" text,
	"normalized_property_number" text,
	"property_exception_id" uuid,
	"unit_value" numeric(18,2),
	"supplier" text,
	"acquired_on" date,
	"year_label" text,
	"fund_cluster" text NOT NULL,
	"accountable_officer" text,
	"office" text NOT NULL,
	"condition" text,
	"remarks" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_lots_property_fields" CHECK (("property_number" IS NULL AND "normalized_property_number" IS NULL AND "property_exception_id" IS NULL) OR ("property_number" IS NOT NULL AND "normalized_property_number" IS NOT NULL AND length(trim("property_number")) > 0 AND length(trim("normalized_property_number")) > 0)),
	CONSTRAINT "custodial_lots_value_nonnegative" CHECK ("unit_value" IS NULL OR "unit_value" >= 0),
	CONSTRAINT "custodial_lots_version_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation_type" "custodial_operation_type" NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "custodial_operations_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_date" date NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custodial_property_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"fund_cluster" text NOT NULL,
	"normalized_property_number" text NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_exception_reason_nonblank" CHECK (length(trim("reason")) > 0),
	CONSTRAINT "custodial_exception_number_nonblank" CHECK (length(trim("normalized_property_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "custodial_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"form_family" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" date,
	"effective_until" date,
	CONSTRAINT "custodial_sections_dates" CHECK ("effective_until" IS NULL OR "effective_from" IS NULL OR "effective_until" >= "effective_from")
);
--> statement-breakpoint
CREATE TABLE "custodial_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operation_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"days_to_consume" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodial_transactions_arithmetic" CHECK ("delta" <> 0 AND "balance_before" >= 0 AND "balance_after" >= 0 AND "balance_after" = "balance_before" + "delta"),
	CONSTRAINT "custodial_transactions_days_nonnegative" CHECK ("days_to_consume" IS NULL OR "days_to_consume" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_balances_lot_unique" ON "custodial_balances" ("item_id","lot_id","fund_cluster","office") WHERE "lot_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_balances_unlotted_unique" ON "custodial_balances" ("item_id","fund_cluster","office") WHERE "lot_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_items_normalized_code_unique" ON "custodial_items" ("normalized_code");--> statement-breakpoint
CREATE INDEX "custodial_lots_item_idx" ON "custodial_lots" ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_lots_identity_scope_unique" ON "custodial_lots" ("id","item_id","fund_cluster");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_lots_property_unique" ON "custodial_lots" ("fund_cluster","normalized_property_number") WHERE "normalized_property_number" IS NOT NULL AND "property_exception_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_operations_operation_id_unique" ON "custodial_operations" ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_operations_sequence_unique" ON "custodial_operations" ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_exception_scope_unique" ON "custodial_property_exceptions" ("id","fund_cluster","normalized_property_number");--> statement-breakpoint
CREATE UNIQUE INDEX "custodial_sections_code_unique" ON "custodial_sections" ("code");--> statement-breakpoint
CREATE INDEX "custodial_transactions_balance_idx" ON "custodial_transactions" ("balance_id","created_at");--> statement-breakpoint
ALTER TABLE "custodial_balances" ADD CONSTRAINT "custodial_balances_item_id_custodial_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "custodial_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_balances" ADD CONSTRAINT "custodial_balances_lot_id_custodial_lots_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "custodial_lots"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_balances" ADD CONSTRAINT "custodial_balances_lot_scope_fk" FOREIGN KEY ("lot_id","item_id","fund_cluster") REFERENCES "custodial_lots"("id","item_id","fund_cluster") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_items" ADD CONSTRAINT "custodial_items_default_section_id_custodial_sections_id_fkey" FOREIGN KEY ("default_section_id") REFERENCES "custodial_sections"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_lots" ADD CONSTRAINT "custodial_lots_item_id_custodial_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "custodial_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_lots" ADD CONSTRAINT "custodial_lots_exception_scope_fk" FOREIGN KEY ("property_exception_id","fund_cluster","normalized_property_number") REFERENCES "custodial_property_exceptions"("id","fund_cluster","normalized_property_number") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_operations" ADD CONSTRAINT "custodial_operations_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_property_exceptions" ADD CONSTRAINT "custodial_property_exceptions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_transactions" ADD CONSTRAINT "custodial_transactions_FT2YRLyZqO5u_fkey" FOREIGN KEY ("operation_id") REFERENCES "custodial_operations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_transactions" ADD CONSTRAINT "custodial_transactions_balance_id_custodial_balances_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "custodial_balances"("id") ON DELETE RESTRICT;