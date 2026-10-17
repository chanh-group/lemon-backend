DROP INDEX "notes_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_uq" ON "notes" USING btree ("user_id");