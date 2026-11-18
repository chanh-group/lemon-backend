import { Module } from "@nestjs/common";
import { NoteModule } from "../../domain/note/module.js";
import { StoryModule } from "../../domain/story/module.js";
import { AuthModule } from "../../domain/auth/module.js";
import { ConversationModule } from "../../domain/conversation/module.js";
import { PurgeJob } from "./job.js";

@Module({
  imports: [StoryModule, NoteModule, AuthModule, ConversationModule],
  providers: [PurgeJob],
})
export class PurgeModule {}
