ALTER TABLE "conversation_participants" ADD COLUMN "history_boundary_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "creator_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "create_request_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_history_boundary_message_id_messages_id_fk" FOREIGN KEY ("history_boundary_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_group_request_uq" ON "conversations" USING btree ("creator_id","create_request_id") WHERE "conversations"."kind" = 'GROUP' AND "conversations"."create_request_id" IS NOT NULL;