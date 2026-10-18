import type { UserResponseDto } from "../../user/dto/response.js";

export interface AuthTokenResponseDto {
  accessToken: string;
}

export interface LoginResponseDto {
  accessToken: string;
  user: UserResponseDto;
}

export interface MessageResponseDto {
  message: string;
}

export interface VerifyOtpResponseDto {
  valid: boolean;
}
