import type { UserResponseDto } from "../../user/dto/response.js";
import type {
  AuthTokenResponseDto,
  LoginResponseDto,
  MessageResponseDto,
  VerifyOtpResponseDto,
} from "./response.js";

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

export function toMessageResponse(message: string): MessageResponseDto {
  return {
    message,
  };
}

export function toVerifyOtpResponse(valid: boolean): VerifyOtpResponseDto {
  return {
    valid,
  };
}
