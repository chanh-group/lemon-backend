ALTER TABLE "story_reactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "story_reactions" ALTER COLUMN "created_at" SET DEFAULT now();