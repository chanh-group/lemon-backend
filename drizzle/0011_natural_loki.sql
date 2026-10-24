CREATE TYPE "public"."story_audience_mode" AS ENUM('ALL_FRIENDS', 'CUSTOM', 'EXCLUDE');--> statement-breakpoint
CREATE TYPE "public"."story_reaction_kind" AS ENUM('REACTION', 'LIKE');--> statement-breakpoint
CREATE TABLE "story_audiences" (
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "story_audiences_story_id_user_id_pk" PRIMARY KEY("story_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "story_mutes" (
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_mutes_user_id_author_id_pk" PRIMARY KEY("user_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "user_story_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"viewed_receipts_enabled" boolean DEFAULT true NOT NULL,
	"archive_enabled" boolean DEFAULT true NOT NULL,
	"archive_duration_secs" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "allow_replies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "allow_reactions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "audience_mode" "story_audience_mode" DEFAULT 'ALL_FRIENDS' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "story_reactions" ADD COLUMN "kind" "story_reaction_kind" DEFAULT 'REACTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_views" ADD COLUMN "anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story_audiences" ADD CONSTRAINT "story_audiences_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_audiences" ADD CONSTRAINT "story_audiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_mutes" ADD CONSTRAINT "story_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_mutes" ADD CONSTRAINT "story_mutes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_story_settings" ADD CONSTRAINT "user_story_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_audiences_user_idx" ON "story_audiences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "story_audiences_story_idx" ON "story_audiences" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_mutes_user_idx" ON "story_mutes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stories_archived_idx" ON "stories" USING btree ("archived_at");