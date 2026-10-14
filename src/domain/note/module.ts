import { Module } from "@nestjs/common";
import { NoteController } from "./controller.js";
import { NotePgRepository } from "./pg.js";
import { NOTE_REPOSITORY } from "./repository.js";
import { NoteService } from "./service.js";

@Module({
  controllers: [NoteController],
  providers: [
    NoteService,
    NotePgRepository,
    {
      provide: NOTE_REPOSITORY,
      useExisting: NotePgRepository,
    },
  ],
  exports: [NoteService, NOTE_REPOSITORY],
})
export class NoteModule {}
