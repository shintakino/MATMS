CREATE TABLE "custodial_item_codes" (
	"normalized_code" text PRIMARY KEY,
	"item_id" uuid NOT NULL,
	"code" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custodial_items" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "custodial_item_codes" ADD CONSTRAINT "custodial_item_codes_item_id_custodial_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "custodial_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "custodial_items" ADD CONSTRAINT "custodial_items_version_nonnegative" CHECK ("version" >= 0);--> statement-breakpoint
INSERT INTO "custodial_item_codes" ("normalized_code", "item_id", "code", "assigned_at")
SELECT "normalized_code", "id", "code", "created_at" FROM "custodial_items";
