CREATE TABLE "story_reactions" (
	"story_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_reactions_story_id_user_id_pk" PRIMARY KEY("story_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "story_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "story_preview" jsonb;--> statement-breakpoint
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reactions" ADD CONSTRAINT "story_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_reactions_story_idx" ON "story_reactions" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "story_reactions_user_idx" ON "story_reactions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_story_idx" ON "messages" USING btree ("story_id");