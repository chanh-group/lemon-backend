import { Body, Controller, Delete, Get, Put, Req } from "@nestjs/common";
import { Lang } from "../../utils/decorators.js";
import { t } from "../../utils/i18n/index.js";
import { messageOnly, ok, withMessage } from "../../utils/response.js";
import { getAuthUser, type AuthUser } from "../shared.js";
import { upsertNoteSchema, type UpsertNoteDto } from "./dto/request.js";
import { NoteService } from "./service.js";

@Controller("notes")
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Put()
  async upsertNote(
    @Req() req: { user?: unknown },
    @Body({ schema: upsertNoteSchema }) dto: UpsertNoteDto,
    @Lang() lang: string,
  ) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.noteService.upsertNote(userId, dto);
    return withMessage(data, t("NOTE_UPDATED", lang));
  }

  @Get("feed")
  async getFeed(@Req() req: { user?: unknown }) {
    const { id: userId }: AuthUser = getAuthUser(req);
    const data = await this.noteService.getFeed(userId);
    return ok(data);
  }

  @Delete("me")
  async deleteMyNote(@Req() req: { user?: unknown }, @Lang() lang: string) {
    const { id: userId }: AuthUser = getAuthUser(req);
    await this.noteService.deleteMyNote(userId);
    return messageOnly(t("NOTE_DELETED", lang));
  }
}
