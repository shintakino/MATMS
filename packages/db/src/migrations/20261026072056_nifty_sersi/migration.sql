CREATE TYPE "confidentiality" AS ENUM('internal', 'restricted');--> statement-breakpoint
CREATE TYPE "folder_color" AS ENUM('yellow', 'blue', 'red', 'other');--> statement-breakpoint
CREATE TYPE "record_lifecycle" AS ENUM('active', 'archived', 'retired');--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"box_id" uuid,
	"folder_id" uuid,
	"document_id" uuid,
	"granted_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "access_grants_exactly_one_target" CHECK ((case when "box_id" is null then 0 else 1 end + case when "folder_id" is null then 0 else 1 end + case when "document_id" is null then 0 else 1 end) = 1)
);
--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"category_id" uuid NOT NULL,
	"shelf_location_id" uuid NOT NULL,
	"lifecycle" "record_lifecycle" DEFAULT 'active'::"record_lifecycle" NOT NULL,
	"confidentiality" "confidentiality" DEFAULT 'internal'::"confidentiality" NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"folder_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"title" text NOT NULL,
	"document_date" text,
	"covered_period" text,
	"keywords" text,
	"description" text,
	"digital_url" text,
	"confidentiality" "confidentiality" DEFAULT 'internal'::"confidentiality" NOT NULL,
	"lifecycle" "record_lifecycle" DEFAULT 'active'::"record_lifecycle" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"box_id" uuid NOT NULL,
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"name" text NOT NULL,
	"color" "folder_color" DEFAULT 'other'::"folder_color" NOT NULL,
	"is_template_folder" boolean DEFAULT false NOT NULL,
	"urgency" text,
	"notes" text,
	"confidentiality" "confidentiality" DEFAULT 'internal'::"confidentiality" NOT NULL,
	"lifecycle" "record_lifecycle" DEFAULT 'active'::"record_lifecycle" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"box_id" uuid,
	"folder_id" uuid,
	"document_id" uuid,
	"source" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movement_events_exactly_one_target" CHECK ((case when "box_id" is null then 0 else 1 end + case when "folder_id" is null then 0 else 1 end + case when "document_id" is null then 0 else 1 end) = 1)
);
--> statement-breakpoint
CREATE TABLE "shelf_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"room" text NOT NULL,
	"shelf" text NOT NULL,
	"rack" text NOT NULL,
	"position" text,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_active_box_unique" ON "access_grants" ("user_id","box_id") WHERE "active" = true and "box_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_active_folder_unique" ON "access_grants" ("user_id","folder_id") WHERE "active" = true and "folder_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_active_document_unique" ON "access_grants" ("user_id","document_id") WHERE "active" = true and "document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "boxes_normalized_code_unique" ON "boxes" ("normalized_code");--> statement-breakpoint
CREATE INDEX "boxes_category_location_idx" ON "boxes" ("category_id","shelf_location_id");--> statement-breakpoint
CREATE INDEX "boxes_lifecycle_confidentiality_idx" ON "boxes" ("lifecycle","confidentiality");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_normalized_code_unique" ON "categories" ("normalized_code");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_normalized_code_unique" ON "documents" ("normalized_code");--> statement-breakpoint
CREATE INDEX "documents_folder_lifecycle_idx" ON "documents" ("folder_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_normalized_code_unique" ON "folders" ("normalized_code");--> statement-breakpoint
CREATE INDEX "folders_box_lifecycle_idx" ON "folders" ("box_id","lifecycle");--> statement-breakpoint
CREATE INDEX "movement_events_occurred_at_idx" ON "movement_events" ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_locations_normalized_code_unique" ON "shelf_locations" ("normalized_code");--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_box_id_boxes_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_folder_id_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_category_id_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_shelf_location_id_shelf_locations_id_fkey" FOREIGN KEY ("shelf_location_id") REFERENCES "shelf_locations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_box_id_boxes_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_box_id_boxes_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_folder_id_folders_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "movement_events" ADD CONSTRAINT "movement_events_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;