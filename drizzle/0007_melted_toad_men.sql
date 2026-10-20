DROP INDEX "friendships_addressee_idx";--> statement-breakpoint
DROP INDEX "friendships_requester_idx";--> statement-breakpoint
DROP INDEX "conversations_inbox_order_idx";--> statement-breakpoint
CREATE INDEX "story_views_story_cursor_idx" ON "story_views" USING btree ("story_id","viewed_at" DESC NULLS LAST,"user_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id","status","requester_id");--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" USING btree ("requester_id","status","addressee_id");--> statement-breakpoint
CREATE INDEX "conversations_inbox_order_idx" ON "conversations" USING btree (coalesce("last_message_at", "created_at") DESC,"id" DESC NULLS LAST) WHERE "conversations"."deleted_at" IS NULL;