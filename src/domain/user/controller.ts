import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../utils/decorators.js";
import { ok } from "../../utils/response.js";
import { toUserResponse } from "./dto/mapper.js";
import { UserService } from "./service.js";

interface UserSearchResponse {
  id: string;
  name: string;
  username: string;
  email: string;
}

const MAX_SEARCH_LENGTH = 64;

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("search")
  async search(
    @Query("q") query: string | undefined,
    @Query("field") field: string | undefined,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<UserSearchResponse[]> {
    const value = query?.trim() ?? "";
    if (value.length < 2 || value.length > MAX_SEARCH_LENGTH) {
      return [];
    }
    const searchField = field === "email" ? "email" : field === "username" ? "username" : null;
    if (!searchField) {
      return [];
    }
    const users = await this.userService.search(value, searchField, currentUser.id);
    return users.map((user) => ({
      id: user.id,
      name: user.fullName,
      username: user.username,
      email: user.email,
    }));
  }

  @Get("by-username/:username")
  async getByUsername(@Param("username") username: string) {
    const cleanUsername = decodeURIComponent(username).trim().toLowerCase().replace(/^@/, "");
    const user = await this.userService.findByUsername(cleanUsername);
    return ok(user ? toUserResponse(user) : null);
  }

  @Get("by-email/:email")
  async getByEmail(@Param("email") email: string) {
    const cleanEmail = decodeURIComponent(email).trim().toLowerCase();
    const user = await this.userService.findByEmail(cleanEmail);
    return ok(user ? toUserResponse(user) : null);
  }
}
