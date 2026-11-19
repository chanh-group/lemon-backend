CREATE TYPE "public"."avatar_cleanup_status" AS ENUM('PENDING', 'PROCESSING', 'FAILED');--> statement-breakpoint
CREATE TABLE "avatar_cleanup_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid,
	"object_key" text NOT NULL,
	"status" "avatar_cleanup_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatar_cleanup_jobs_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "history_boundary_was_empty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "join_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "avatar_cleanup_jobs" ADD CONSTRAINT "avatar_cleanup_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_cleanup_status_idx" ON "avatar_cleanup_jobs" USING btree ("status","created_at");--> statement-breakpoint
UPDATE "conversation_participants" cp
SET "history_boundary_was_empty" = true
WHERE cp."history_boundary_message_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."conversation_id" = cp."conversation_id"
      AND m."created_at" <= cp."joined_at"
  );
