ALTER TABLE "conversation_participants" DROP CONSTRAINT "conversation_participants_history_boundary_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_history_boundary_message_id_messages_id_fk" FOREIGN KEY ("history_boundary_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participants_history_boundary_idx" ON "conversation_participants" USING btree ("history_boundary_message_id");--> statement-breakpoint
CREATE INDEX "message_hidden_user_idx" ON "message_hidden_for_users" USING btree ("user_id");