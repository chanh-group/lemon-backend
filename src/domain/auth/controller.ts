import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser, Public, type AuthUser } from "../../utils/decorators.js";
import { BusinessError } from "../../utils/errors/business.js";
import { toUserResponse } from "../user/dto/mapper.js";
import type { UserResponseDto } from "../user/dto/response.js";
import { UserService } from "../user/service.js";
import { REFRESH_COOKIE_NAME } from "./constants.js";
import {
  clearRefreshCookieOptions,
  refreshCookieOptions,
  resolveCookieConfig,
  type CookieConfig,
} from "./cookies.js";
import {
  toAuthTokenResponse,
  toLoginResponse,
  toMessageResponse,
  toVerifyOtpResponse,
} from "./dto/mapper.js";
import type {
  ChangePasswordInput,
  ForgotPasswordOtpInput,
  ForgotPasswordResetInput,
  LoginInput,
  RequestOtpInput,
  SignupInput,
  VerifyOtpInput,
} from "./dto/request.js";
import type {
  AuthTokenResponseDto,
  LoginResponseDto,
  MessageResponseDto,
  VerifyOtpResponseDto,
} from "./dto/response.js";
import { AuthService } from "./service.js";

function extractRefreshToken(req: Request): string | undefined {
  const cookies = req.cookies as unknown;
  if (cookies && typeof cookies === "object" && REFRESH_COOKIE_NAME in cookies) {
    const val = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }

  const header = req.headers["x-refresh-token"];
  if (typeof header === "string" && header.trim().length > 0) {
    return header.trim();
  }

  return undefined;
}

function setRefreshCookie(res: Response, refreshToken: string, cfg: CookieConfig): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(cfg));
}

function clearRefreshCookie(res: Response, cfg: CookieConfig): void {
  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions(cfg));
}

@Controller("auth")
export class AuthController {
  // Resolved during construction → invalid cookie env fails the boot.
  private readonly cookieConfig: CookieConfig;

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {
    this.cookieConfig = resolveCookieConfig();
  }

  @Public()
  @Post("request-otp")
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body() body: RequestOtpInput,
    @Headers("x-request-id") requestId?: string,
  ): Promise<MessageResponseDto> {
    await this.authService.requestOtp(body, requestId);
    return toMessageResponse("Mã OTP xác thực đã được gửi đến email của bạn");
  }

  @Public()
  @Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpInput): Promise<VerifyOtpResponseDto> {
    const valid = await this.authService.verifyOtp(body);
    return toVerifyOtpResponse(valid);
  }

  @Public()
  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: SignupInput): Promise<UserResponseDto> {
    return this.authService.signup(body);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(body);
    setRefreshCookie(res, result.tokens.refreshToken, this.cookieConfig);
    return toLoginResponse(result.tokens.accessToken, result.user);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponseDto> {
    const rawRefreshToken = extractRefreshToken(req);
    if (!rawRefreshToken) {
      throw new BusinessError("UNAUTHORIZED");
    }

    const newTokens = await this.authService.refreshToken(rawRefreshToken);
    setRefreshCookie(res, newTokens.refreshToken, this.cookieConfig);
    return toAuthTokenResponse(newTokens.accessToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    const rawRefreshToken = extractRefreshToken(req);
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    clearRefreshCookie(res, this.cookieConfig);
    return toMessageResponse("Đăng xuất thành công");
  }

  @Public()
  @Post("forgot-password/otp")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordOtp(
    @Body() body: ForgotPasswordOtpInput,
    @Headers("x-request-id") requestId?: string,
  ): Promise<MessageResponseDto> {
    await this.authService.forgotPasswordOtp(body, requestId);
    return toMessageResponse("Nếu email tồn tại trong hệ thống, mã OTP khôi phục đã được gửi");
  }

  @Public()
  @Post("forgot-password/reset")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordReset(@Body() body: ForgotPasswordResetInput): Promise<MessageResponseDto> {
    await this.authService.forgotPasswordReset(body);
    return toMessageResponse("Đặt lại mật khẩu thành công. Vui lòng đăng nhập với mật khẩu mới");
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(user.id, body);
    clearRefreshCookie(res, this.cookieConfig);
    return toMessageResponse("Đổi mật khẩu thành công. Vui lòng đăng nhập lại");
  }

  @Get("me")
  async getMe(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    const entity = await this.userService.findById(user.id);
    if (!entity) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    return toUserResponse(entity);
  }
}
