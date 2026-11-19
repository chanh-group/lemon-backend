CREATE TABLE "message_hidden_for_users" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_hidden_for_users_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
DROP INDEX "messages_timeline_idx";--> statement-breakpoint
ALTER TABLE "message_hidden_for_users" ADD CONSTRAINT "message_hidden_for_users_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_hidden_for_users" ADD CONSTRAINT "message_hidden_for_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_timeline_idx" ON "messages" USING btree ("conversation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);