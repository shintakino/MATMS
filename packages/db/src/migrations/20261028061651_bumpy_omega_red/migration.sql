CREATE TABLE "custodial_master_replays" (
	"operation_id" uuid PRIMARY KEY,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"target_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custodial_master_replays" ADD CONSTRAINT "custodial_master_replays_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;