ALTER TYPE "public"."message_kind" ADD VALUE 'STORY_REPLY';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'STORY_REACTION';--> statement-breakpoint
ALTER TABLE "story_reactions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;