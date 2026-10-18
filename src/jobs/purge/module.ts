import { Module } from "@nestjs/common";
import { NoteModule } from "../../domain/note/module.js";
import { StoryModule } from "../../domain/story/module.js";
import { PurgeJob } from "./job.js";

@Module({
  imports: [StoryModule, NoteModule],
  providers: [PurgeJob],
})
export class PurgeModule {}
