import type { UserResponseDto } from "../../user/dto/response.js";
import type { AuthTokenResponseDto, LoginResponseDto } from "./response.js";

export function toAuthTokenResponse(accessToken: string): AuthTokenResponseDto {
  return {
    accessToken,
  };
}

export function toLoginResponse(accessToken: string, user: UserResponseDto): LoginResponseDto {
  return {
    accessToken,
    user,
  };
}
