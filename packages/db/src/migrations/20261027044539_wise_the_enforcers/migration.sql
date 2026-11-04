ALTER TABLE "document_checkouts" DROP CONSTRAINT "document_checkouts_single_closure";--> statement-breakpoint
DROP INDEX "document_checkouts_one_unresolved_per_document";--> statement-breakpoint
CREATE UNIQUE INDEX "document_checkouts_one_unresolved_per_document" ON "document_checkouts" ("document_id") WHERE "resolved_at" IS NULL AND ("returned_at" IS NULL OR "exception" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "document_checkouts" ADD CONSTRAINT "document_checkouts_resolution_after_return" CHECK ("resolved_at" IS NULL OR "returned_at" IS NULL OR "resolved_at" >= "returned_at");