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
import { CurrentUser, Lang, Public, type AuthUser } from "../../utils/decorators.js";
import { BusinessError } from "../../utils/errors/business.js";
import { t } from "../../utils/i18n/index.js";
import { created, messageOnly, withMessage } from "../../utils/response.js";
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
    @Lang() lang: string,
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
    return messageOnly(t("OTP_SENT", lang));
  }

  @Public()
  @Post("verify-otp")
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body({ schema: verifyOtpSchema }) body: VerifyOtpDto,
    @Lang() lang: string,
    @Req() req?: Request,
  ) {
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
    return withMessage({ valid }, t("OTP_VERIFIED", lang));
  }

  @Public()
  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body({ schema: signupSchema }) body: SignupDto, @Lang() lang: string) {
    const data = await this.authService.signup(body);
    return created(data, t("USER_CREATED", lang));
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) body: LoginDto,
    @Lang() lang: string,
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
    return withMessage(
      toLoginResponse(result.tokens.accessToken, result.user),
      t("SIGNED_IN", lang),
    );
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Lang() lang: string,
  ) {
    const rawRefreshToken = extractRefreshToken(req);
    if (!rawRefreshToken) {
      throw new BusinessError("UNAUTHORIZED");
    }

    const newTokens = await this.authService.refreshToken(rawRefreshToken);
    setRefreshCookie(res, newTokens.refreshToken, this.cookieConfig);
    return withMessage(toAuthTokenResponse(newTokens.accessToken), t("TOKEN_REFRESHED", lang));
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Lang() lang: string,
  ) {
    const rawRefreshToken = extractRefreshToken(req);
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    clearRefreshCookie(res, this.cookieConfig);
    return messageOnly(t("SIGNED_OUT", lang));
  }

  @Public()
  @Post("forgot-password/otp")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordOtp(
    @Body({ schema: forgotPasswordOtpSchema }) body: ForgotPasswordOtpDto,
    @Lang() lang: string,
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
    return messageOnly(t("OTP_SENT", lang));
  }

  @Public()
  @Post("forgot-password/reset")
  @HttpCode(HttpStatus.OK)
  async forgotPasswordReset(
    @Body({ schema: forgotPasswordResetSchema }) body: ForgotPasswordResetDto,
    @Lang() lang: string,
  ) {
    await this.authService.forgotPasswordReset(body);
    return messageOnly(t("PASSWORD_RESET", lang));
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
    @Lang() lang: string,
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
    return messageOnly(t("PASSWORD_CHANGED", lang));
  }

  @Get("me")
  async getMe(@CurrentUser() user: AuthUser, @Lang() lang: string) {
    const entity = await this.userService.findById(user.id);
    if (!entity) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    return withMessage(toUserResponse(entity), t("USER_FOUND", lang));
  }
}
