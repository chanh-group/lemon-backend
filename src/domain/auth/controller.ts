import {
  Body,
  Controller,
  Inject,
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
import { extractClientIp } from "../../middleware/ratelimit.js";
import type { RateLimiter } from "../../middleware/ratelimit.js";
import { MemoryRateLimiter } from "../../middleware/ratelimit.js";
import { toUserResponse } from "../user/dto/mapper.js";
import { UserService } from "../user/service.js";
import {
  RATE_LIMIT_CHANGE_PASSWORD_IP_MAX,
  RATE_LIMIT_CHANGE_PASSWORD_USER_MAX,
  RATE_LIMIT_EMAIL_WINDOW_SECS,
  RATE_LIMIT_FORGOT_PASSWORD_OTP_IP_MAX,
  RATE_LIMIT_REQUEST_OTP_EMAIL_MAX,
  RATE_LIMIT_REQUEST_OTP_IP_MAX,
  RATE_LIMIT_SIGNIN_IP_MAX,
  RATE_LIMIT_VERIFY_OTP_IP_MAX,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMITER,
  REFRESH_COOKIE_NAME,
} from "./constants.js";
import {
  clearRefreshCookieOptions,
  refreshCookieOptions,
  resolveCookieConfig,
  type CookieConfig,
} from "./cookies.js";
import { toAuthTokenResponse, toLoginResponse } from "./dto/mapper.js";
import {
  changePasswordSchema,
  forgotPasswordOtpSchema,
  forgotPasswordResetSchema,
  loginSchema,
  requestOtpSchema,
  signupSchema,
  verifyOtpSchema,
} from "./dto/request.js";
import type {
  ChangePasswordDto,
  ForgotPasswordOtpDto,
  ForgotPasswordResetDto,
  LoginDto,
  RequestOtpDto,
  SignupDto,
  VerifyOtpDto,
} from "./dto/request.js";
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
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter = new MemoryRateLimiter(),
  ) {
    this.cookieConfig = resolveCookieConfig();
  }

  @Public()
  @Post("request-otp")
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body({ schema: requestOtpSchema }) body: RequestOtpDto,
    @Headers("x-request-id") requestId?: string,
    @Req() req?: Request,
  ) {
    const ip = extractClientIp(req);
    if (
      !(await this.rateLimiter.checkIpLimit(
        "request-otp",
        ip,
        RATE_LIMIT_REQUEST_OTP_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    if (
      !(await this.rateLimiter.checkEmailLimit(
        "request-otp",
        body.email,
        RATE_LIMIT_REQUEST_OTP_EMAIL_MAX,
        RATE_LIMIT_EMAIL_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    await this.authService.requestOtp(body, requestId);
    return {
      success: true,
      message: "OTP sent successfully",
    };
  }

  @Public()
  @Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body({ schema: verifyOtpSchema }) body: VerifyOtpDto, @Req() req?: Request) {
    const ip = extractClientIp(req);
    if (
      !(await this.rateLimiter.checkIpLimit(
        "verify-otp",
        ip,
        RATE_LIMIT_VERIFY_OTP_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    const valid = await this.authService.verifyOtp(body);
    return {
      success: true,
      message: "OTP verified successfully",
      data: { valid },
    };
  }

  @Public()
  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body({ schema: signupSchema }) body: SignupDto) {
    const data = await this.authService.signup(body);
    return {
      success: true,
      message: "Signed up successfully",
      data,
    };
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) body: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Request,
  ) {
    const ip = extractClientIp(req);
    if (
      !(await this.rateLimiter.checkIpLimit(
        "signin",
        ip,
        RATE_LIMIT_SIGNIN_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    const result = await this.authService.login(body);
    setRefreshCookie(res, result.tokens.refreshToken, this.cookieConfig);
    return {
      success: true,
      message: "Signed in successfully",
      data: toLoginResponse(result.tokens.accessToken, result.user),
    };
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = extractRefreshToken(req);
    if (!rawRefreshToken) {
      throw new BusinessError("UNAUTHORIZED");
    }

    const newTokens = await this.authService.refreshToken(rawRefreshToken);
    setRefreshCookie(res, newTokens.refreshToken, this.cookieConfig);
    return {
      success: true,
      message: "OK",
      data: toAuthTokenResponse(newTokens.accessToken),
    };
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = extractRefreshToken(req);
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    clearRefreshCookie(res, this.cookieConfig);
    return {
      success: true,
      message: "Signed out successfully",
    };
  }

  @Public()
  @Post("forgot-password/otp")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordOtp(
    @Body({ schema: forgotPasswordOtpSchema }) body: ForgotPasswordOtpDto,
    @Headers("x-request-id") requestId?: string,
    @Req() req?: Request,
  ) {
    const ip = extractClientIp(req);
    if (
      !(await this.rateLimiter.checkIpLimit(
        "forgot-password-otp",
        ip,
        RATE_LIMIT_FORGOT_PASSWORD_OTP_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    if (
      !(await this.rateLimiter.checkEmailLimit(
        "forgot-password-otp",
        body.email,
        RATE_LIMIT_REQUEST_OTP_EMAIL_MAX,
        RATE_LIMIT_EMAIL_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    await this.authService.forgotPasswordOtp(body, requestId);
    return {
      success: true,
      message: "If the email exists, a reset OTP has been sent",
    };
  }

  @Public()
  @Post("forgot-password/reset")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordReset(
    @Body({ schema: forgotPasswordResetSchema }) body: ForgotPasswordResetDto,
  ) {
    await this.authService.forgotPasswordReset(body);
    return {
      success: true,
      message: "Password reset successfully",
    };
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: Request,
  ) {
    const ip = extractClientIp(req);
    if (
      !(await this.rateLimiter.checkMixedLimit(
        "change-password",
        user.id,
        ip,
        RATE_LIMIT_CHANGE_PASSWORD_USER_MAX,
        RATE_LIMIT_CHANGE_PASSWORD_IP_MAX,
        RATE_LIMIT_WINDOW_SECS,
      ))
    ) {
      throw new BusinessError("TOO_MANY_REQUESTS");
    }
    await this.authService.changePassword(user.id, body);
    clearRefreshCookie(res, this.cookieConfig);
    return {
      success: true,
      message: "Password changed successfully. Please sign in again",
    };
  }

  @Get("me")
  async getMe(@CurrentUser() user: AuthUser) {
    const entity = await this.userService.findById(user.id);
    if (!entity) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    return {
      success: true,
      message: "OK",
      data: toUserResponse(entity),
    };
  }
}
