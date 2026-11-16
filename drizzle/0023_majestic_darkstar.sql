ALTER TABLE "conversation_participants" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "conversation_participants" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::text;--> statement-breakpoint
UPDATE "conversation_participants" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';--> statement-breakpoint
DROP TYPE "public"."participant_role";--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('MEMBER', 'ADMIN');--> statement-breakpoint
ALTER TABLE "conversation_participants" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"public"."participant_role";--> statement-breakpoint
ALTER TABLE "conversation_participants" ALTER COLUMN "role" SET DATA TYPE "public"."participant_role" USING "role"::"public"."participant_role";
