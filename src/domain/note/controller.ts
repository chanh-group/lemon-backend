import { Body, Controller, Delete, Get, Put } from "@nestjs/common";
import { CurrentUserId } from "../story/controller.js";
import type { UpsertNoteDto } from "./dto/request.js";
import { NoteService } from "./service.js";

@Controller("notes")
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Put()
  async upsertNote(@CurrentUserId() userId: string, @Body() dto: UpsertNoteDto) {
    const data = await this.noteService.upsertNote(userId, dto);
    return {
      success: true,
      message: "Note updated successfully",
      data,
    };
  }

  @Get("feed")
  async getFeed(@CurrentUserId() userId: string) {
    const data = await this.noteService.getFeed(userId);
    return {
      success: true,
      message: "OK",
      data,
    };
  }

  @Delete("me")
  async deleteMyNote(@CurrentUserId() userId: string) {
    await this.noteService.deleteMyNote(userId);
    return {
      success: true,
      message: "Note deleted successfully",
    };
  }
}
