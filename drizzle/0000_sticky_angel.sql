CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE TYPE "public"."friendship_status" AS ENUM('PENDING', 'ACCEPTED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."conversation_kind" AS ENUM('DIRECT', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('MEMBER', 'ADMIN', 'OWNER');--> statement-breakpoint
CREATE TYPE "public"."attachment_kind" AS ENUM('IMAGE', 'VIDEO', 'AUDIO', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."call_media" AS ENUM('VOICE', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('INITIATED', 'RINGING', 'ACCEPTED', 'REJECTED', 'MISSED', 'CANCELLED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."story_kind" AS ENUM('IMAGE', 'VIDEO', 'TEXT');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"google_id" text,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"avatar_url" text,
	"bio" text,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_format_chk" CHECK ("users"."username" ~ '^[a-z0-9_]{3,30}$'),
	CONSTRAINT "users_full_name_chk" CHECK (char_length(btrim("users"."full_name")) BETWEEN 2 AND 100)
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"status" "friendship_status" DEFAULT 'PENDING' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_pair_uq" UNIQUE("user_low","user_high"),
	CONSTRAINT "friendships_no_self_chk" CHECK ("friendships"."requester_id" <> "friendships"."addressee_id"),
	CONSTRAINT "friendships_pair_chk" CHECK ("friendships"."user_low" < "friendships"."user_high")
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "participant_role" DEFAULT 'MEMBER' NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"muted_until" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "conversation_kind" DEFAULT 'DIRECT' NOT NULL,
	"direct_key" text,
	"title" text,
	"avatar_url" text,
	"last_message_id" uuid,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_direct_chk" CHECK ("conversations"."kind" <> 'DIRECT' OR "conversations"."direct_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" "message_kind" DEFAULT 'TEXT' NOT NULL,
	"body" text,
	"reply_to_id" uuid,
	"client_msg_id" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_content_chk" CHECK ("messages"."body" IS NOT NULL OR "messages"."kind" IN ('IMAGE', 'VIDEO', 'AUDIO', 'FILE')),
	CONSTRAINT "messages_body_len_chk" CHECK ("messages"."body" IS NULL OR char_length("messages"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"callee_id" uuid NOT NULL,
	"media" "call_media" NOT NULL,
	"status" "call_status" DEFAULT 'INITIATED' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"duration_secs" integer GENERATED ALWAYS AS (CASE WHEN answered_at IS NULL OR ended_at IS NULL THEN 0 ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (ended_at - answered_at))))::INT END) STORED,
	CONSTRAINT "calls_no_self_chk" CHECK ("calls"."caller_id" <> "calls"."callee_id")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "story_kind" NOT NULL,
	"bucket" text,
	"object_key" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"caption" text,
	"background" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stories_media_chk" CHECK ("stories"."kind" = 'TEXT' OR "stories"."object_key" IS NOT NULL),
	CONSTRAINT "stories_expiry_chk" CHECK ("stories"."expires_at" > "stories"."created_at" AND "stories"."expires_at" <= "stories"."created_at" + INTERVAL '25 hours')
);
--> statement-breakpoint
CREATE TABLE "story_views" (
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_views_story_id_user_id_pk" PRIMARY KEY("story_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"background" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notes_content_len_chk" CHECK (char_length("notes"."content") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_users_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_uq" ON "users" USING btree ("google_id") WHERE "users"."google_id" IS NOT NULL AND "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone") WHERE "users"."phone" IS NOT NULL AND "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_last_seen" ON "users" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "friendships_low_idx" ON "friendships" USING btree ("user_low") WHERE "friendships"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "friendships_high_idx" ON "friendships" USING btree ("user_high") WHERE "friendships"."status" = 'ACCEPTED';--> statement-breakpoint
CREATE INDEX "participants_user_idx" ON "conversation_participants" USING btree ("user_id") WHERE "conversation_participants"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_key_uq" ON "conversations" USING btree ("direct_key") WHERE "conversations"."direct_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_last_message_idx" ON "conversations" USING btree ("last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_active_idx" ON "conversations" USING btree ("last_message_at" DESC NULLS LAST) WHERE "conversations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "message_attachments_msg_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_msg_uq" ON "messages" USING btree ("conversation_id","sender_id","client_msg_id") WHERE "messages"."client_msg_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_timeline_idx" ON "messages" USING btree ("conversation_id","id" DESC NULLS LAST) WHERE "messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_reply_idx" ON "messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX "calls_conv_idx" ON "calls" USING btree ("conversation_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_caller_idx" ON "calls" USING btree ("caller_id","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_callee_idx" ON "calls" USING btree ("callee_id","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stories_user_idx" ON "stories" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stories_expiry_idx" ON "stories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "story_views_viewer_idx" ON "story_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "notes" USING btree ("user_id","expires_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_expiry_idx" ON "notes" USING btree ("expires_at");