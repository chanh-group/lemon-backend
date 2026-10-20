DROP INDEX "conversations_last_message_idx";--> statement-breakpoint
DROP INDEX "conversations_active_idx";--> statement-breakpoint
CREATE INDEX "conversations_inbox_order_idx" ON "conversations" USING btree (coalesce("last_message_at", "created_at") DESC) WHERE "conversations"."deleted_at" IS NULL;