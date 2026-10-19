import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser, type AuthUser } from "../../utils/decorators.js";
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
}
