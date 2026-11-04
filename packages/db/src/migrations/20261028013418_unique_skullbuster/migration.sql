DROP INDEX "documents_search_order_idx";--> statement-breakpoint
CREATE INDEX "documents_search_order_idx" ON "documents" (lower("code") COLLATE "C",("id"::text));--> statement-breakpoint
DROP INDEX "boxes_search_order_idx";--> statement-breakpoint
CREATE INDEX "boxes_search_order_idx" ON "boxes" (lower("code") COLLATE "C",("id"::text));--> statement-breakpoint
DROP INDEX "folders_search_order_idx";--> statement-breakpoint
CREATE INDEX "folders_search_order_idx" ON "folders" (lower("code") COLLATE "C",("id"::text));