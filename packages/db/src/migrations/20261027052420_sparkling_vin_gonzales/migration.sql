CREATE TABLE "school_settings" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"school_name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"canonical_origin" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_settings_singleton" CHECK ("id" = 1)
);
