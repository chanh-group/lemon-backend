import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../utils/decorators.js";
import { ok } from "../../utils/response.js";
import { parseCursorPage } from "../shared.js";
import { USER_SEARCH_MAX_LENGTH, USER_SEARCH_MIN_LENGTH } from "./constants.js";
import { toPublicUserResponse } from "./dto/mapper.js";
import { UserService } from "./service.js";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("search")
  async search(
    @Query("q") query: string | undefined,
    @Query("field") field: string | undefined,
    @CurrentUser() currentUser: AuthUser,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const page = parseCursorPage(cursor, limit, undefined, undefined, {
      allowOpaque: field === "username",
    });
    const value = query?.trim() ?? "";
    if (value.length < USER_SEARCH_MIN_LENGTH || value.length > USER_SEARCH_MAX_LENGTH) {
      return { items: [], hasMore: false };
    }
    const searchField = field === "email" ? "email" : field === "username" ? "username" : null;
    if (!searchField) {
      return { items: [], hasMore: false };
    }
    const users = await this.userService.search(
      value,
      searchField,
      currentUser.id,
      page.cursor,
      page.size,
    );
    return {
      ...users,
      items: users.items.map((user) => ({
        id: user.id,
        name: user.fullName,
        username: user.username,
      })),
    };
  }

  @Get("by-username/:username")
  async getByUsername(@Param("username") username: string) {
    const cleanUsername = decodeURIComponent(username).trim().toLowerCase().replace(/^@/, "");
    const user = await this.userService.findByUsername(cleanUsername);
    return ok(user ? toPublicUserResponse(user) : null);
  }

  @Get("by-email/:email")
  async getByEmail(@Param("email") email: string) {
    const cleanEmail = decodeURIComponent(email).trim().toLowerCase();
    const user = await this.userService.findByEmail(cleanEmail);
    return ok(user ? toPublicUserResponse(user) : null);
  }
}
