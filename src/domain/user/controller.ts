import { Controller, Get, Param } from "@nestjs/common";
import { ok } from "../../utils/response.js";
import { toUserResponse } from "./dto/mapper.js";
import { UserService } from "./service.js";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

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

