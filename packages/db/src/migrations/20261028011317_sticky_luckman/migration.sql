CREATE INDEX "boxes_search_order_idx" ON "boxes" (lower("code"),("id"::text));--> statement-breakpoint
CREATE INDEX "folders_search_order_idx" ON "folders" (lower("code"),("id"::text));