CREATE TYPE "custody_operation_kind" AS ENUM('release', 'return');--> statement-breakpoint
CREATE TYPE "loan_exception_kind" AS ENUM('lost', 'damaged');--> statement-breakpoint
CREATE TYPE "request_kind" AS ENUM('inspect', 'borrow', 'copy');--> statement-breakpoint
CREATE TYPE "request_line_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'fulfilled');--> statement-breakpoint
CREATE TYPE "request_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "custody_operation_replays" (
	"operation_id" uuid PRIMARY KEY,
	"kind" "custody_operation_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"scope_fingerprint" text NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_item_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"home_folder_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"acknowledged" boolean NOT NULL,
	"released_by" text NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"returned_by" text,
	"returned_at" timestamp with time zone,
	"return_condition" text,
	"returned_folder_id" uuid,
	"exception" "loan_exception_kind",
	"exception_notes" text,
	"exception_recorded_by" text,
	"exception_recorded_at" timestamp with time zone,
	"resolution" text,
	"resolution_notes" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "document_checkouts_due_chronology" CHECK ("due_at" >= "released_at"),
	CONSTRAINT "document_checkouts_return_chronology" CHECK ("returned_at" IS NULL OR "returned_at" >= "released_at"),
	CONSTRAINT "document_checkouts_resolution_chronology" CHECK ("resolved_at" IS NULL OR "resolved_at" >= "released_at")
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL,
	"normalized_code" text NOT NULL,
	"requester_name" text NOT NULL,
	"office" text,
	"contact" text,
	"purpose" text NOT NULL,
	"kind" "request_kind" NOT NULL,
	"notes" text,
	"status" "request_status" DEFAULT 'draft'::"request_status" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"request_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "request_line_status" DEFAULT 'pending'::"request_line_status" NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"fulfilled_by" text,
	"fulfilled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_checkouts_one_unresolved_per_document" ON "document_checkouts" ("document_id") WHERE "returned_at" IS NULL AND "resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_checkouts_request_item_unique" ON "document_checkouts" ("request_item_id");--> statement-breakpoint
CREATE INDEX "document_checkouts_due_idx" ON "document_checkouts" ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_requests_normalized_code_unique" ON "document_requests" ("normalized_code");--> statement-breakpoint
CREATE INDEX "document_requests_status_created_idx" ON "document_requests" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_items_request_document_unique" ON "request_items" ("request_id","document_id");--> statement-breakpoint
CREATE INDEX "request_items_document_status_idx" ON "request_items" ("document_id","status");--> statement-breakpoint
ALTER TABLE "custody_operation_replays" ADD CONSTRAINT "custody_operation_replays_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_request_item_id_request_items_id_fkey" FOREIGN KEY ("request_item_id") REFERENCES "request_items"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_home_folder_id_folders_id_fkey" FOREIGN KEY ("home_folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_released_by_user_id_fkey" FOREIGN KEY ("released_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_returned_by_user_id_fkey" FOREIGN KEY ("returned_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_returned_folder_id_folders_id_fkey" FOREIGN KEY ("returned_folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_exception_recorded_by_user_id_fkey" FOREIGN KEY ("exception_recorded_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_document_requests_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_fulfilled_by_user_id_fkey" FOREIGN KEY ("fulfilled_by") REFERENCES "user"("id") ON DELETE RESTRICT;