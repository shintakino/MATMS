CREATE TYPE "stock_operation_type" AS ENUM('receive', 'issue', 'transfer', 'correct');--> statement-breakpoint
CREATE TYPE "template_status" AS ENUM('active', 'superseded', 'retired');--> statement-breakpoint
CREATE TABLE "stock_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"operation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation_type" "stock_operation_type" NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"payload_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"stock_operation_id" uuid NOT NULL,
	"inventory_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transactions_nonzero_delta" CHECK ("delta" <> 0),
	CONSTRAINT "stock_transactions_balance_nonnegative" CHECK ("balance_before" >= 0 and "balance_after" >= 0),
	CONSTRAINT "stock_transactions_arithmetic" CHECK ("balance_after" = "balance_before" + "delta")
);
--> statement-breakpoint
CREATE TABLE "template_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"template_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 5 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_inventory_count_nonnegative" CHECK ("count" >= 0),
	CONSTRAINT "template_inventory_threshold_nonnegative" CHECK ("threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"family_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"revision_label" text NOT NULL,
	"revision_date" text,
	"digital_url" text NOT NULL,
	"status" "template_status" DEFAULT 'active'::"template_status" NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_operations_operation_id_unique" ON "stock_operations" ("operation_id");--> statement-breakpoint
CREATE INDEX "stock_operations_actor_created_idx" ON "stock_operations" ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_transactions_inventory_created_idx" ON "stock_transactions" ("inventory_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "template_inventory_template_folder_unique" ON "template_inventory" ("template_id","folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_normalized_code_unique" ON "templates" ("normalized_code");--> statement-breakpoint
CREATE INDEX "templates_family_status_idx" ON "templates" ("family_code","status");--> statement-breakpoint
ALTER TABLE "stock_operations" ADD CONSTRAINT "stock_operations_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_stock_operation_id_stock_operations_id_fkey" FOREIGN KEY ("stock_operation_id") REFERENCES "stock_operations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_inventory_id_template_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "template_inventory"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "template_inventory" ADD CONSTRAINT "template_inventory_template_id_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "template_inventory" ADD CONSTRAINT "template_inventory_folder_id_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_supersedes_id_templates_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "templates"("id") ON DELETE RESTRICT;