CREATE TABLE "scheduling_edit_replays" (
	"operation_id" uuid PRIMARY KEY,
	"actor_id" text NOT NULL,
	"leave_id" uuid,
	"reservation_id" uuid,
	"fingerprint" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_edit_one_target" CHECK (num_nonnulls("leave_id", "reservation_id") = 1),
	CONSTRAINT "scheduling_edit_version" CHECK ("resulting_version" > 0),
	CONSTRAINT "scheduling_edit_hash" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "scheduling_edit_replays" ADD CONSTRAINT "scheduling_edit_replays_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling_edit_replays" ADD CONSTRAINT "scheduling_edit_replays_leave_id_leave_bookings_id_fkey" FOREIGN KEY ("leave_id") REFERENCES "leave_bookings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "scheduling_edit_replays" ADD CONSTRAINT "scheduling_edit_replays_39l5Qkn8xw9R_fkey" FOREIGN KEY ("reservation_id") REFERENCES "resource_bookings"("id") ON DELETE RESTRICT;