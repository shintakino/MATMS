CREATE TYPE "application_role" AS ENUM('admin', 'staff', 'viewer');--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY,
	"role" "application_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_profiles_active_role_idx" ON "user_profiles" ("active","role");--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT;