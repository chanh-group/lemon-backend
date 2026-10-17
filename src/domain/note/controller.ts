import { Body, Controller, Delete, Get, Put, Req } from "@nestjs/common";
import { getAuthUser, type AuthUser } from "../shared.js";
import type { UpsertNoteDto } from "./dto/request.js";
import { NoteService } from "./service.js";

@Controller("notes")
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Put()
  async upsertNote(@Req() req: { user?: unknown }, @Body() dto: UpsertNoteDto) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.noteService.upsertNote(userId, dto);
    return {
      success: true,
      message: "Note updated successfully",
      data,
    };
  }

  @Get("feed")
  async getFeed(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.noteService.getFeed(userId);
    return {
      success: true,
      message: "OK",
      data,
    };
  }

  @Delete("me")
  async deleteMyNote(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.noteService.deleteMyNote(userId);
    return {
      success: true,
      message: "Note deleted successfully",
    };
  }
}
