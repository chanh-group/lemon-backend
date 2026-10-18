import * as crypto from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import * as argon2 from "argon2";
import { v7 as uuidv7 } from "uuid";
import { ZodError } from "zod";
import {
  FORGOT_OTP_KEY_PREFIX,
  MAX_OTP_ATTEMPTS,
  MAX_SESSIONS_PER_USER,
  OTP_EXPIRATION,
  OTP_KEY_PREFIX,
  REFRESH_TOKEN_EXPIRATION,
  REFRESH_TOKEN_KEY_PREFIX,
  SESSION_KEY_PREFIX,
  USER_CACHE_KEY_PREFIX,
} from "../../utils/cache/constants.js";
import { CacheError } from "../../utils/cache/error.js";
import { CACHE_STORE, type CacheStore } from "../../utils/cache/store.js";
import { OtpCheckOutcome, RotationOutcome } from "../../utils/cache/types.js";
import { BusinessError } from "../../utils/errors/business.js";
import { SystemError } from "../../utils/errors/system.js";
import { MailService } from "../../utils/mail/service.js";
import { toUserResponse } from "../user/dto/mapper.js";
import type { UserResponseDto } from "../user/dto/response.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import {
  ChangePasswordInput,
  changePasswordSchema,
  ForgotPasswordOtpInput,
  forgotPasswordOtpSchema,
  ForgotPasswordResetInput,
  forgotPasswordResetSchema,
  LoginInput,
  loginSchema,
  RequestOtpInput,
  requestOtpSchema,
  SignupInput,
  signupSchema,
  VerifyOtpInput,
  verifyOtpSchema,
} from "./dto/request.js";
import { JWT_CONFIG } from "./constants.js";
import type { JwtConfig } from "./jwt.js";
import type { TokenPair } from "./types.js";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(CACHE_STORE)
    private readonly cacheStore: CacheStore,
    private readonly mailService: MailService,
    @Inject(JWT_CONFIG)
    private readonly jwt: JwtConfig,
  ) {}

  async requestOtp(input: RequestOtpInput, requestId?: string): Promise<void> {
    const data = this.validate(requestOtpSchema, input);

    const existingUser = await this.userRepo.findByEmail(data.email);
    if (existingUser) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }

    const code = this.generateOtp();
    const key = `${OTP_KEY_PREFIX}${data.email}`;

    try {
      await this.cacheStore.setRaw(key, JSON.stringify({ code, attempts: 0 }), OTP_EXPIRATION);
    } catch (err: unknown) {
      this.logger.error("Failed to store OTP in Redis", {
        action: "auth.request_otp_cache_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache SET failed", { cause: err });
    }

    await this.mailService.sendOtp({
      to: data.email,
      code,
      purpose: "signup",
      requestId,
    });

    this.logger.log("Registration OTP requested", {
      action: "auth.request_otp",
      email: data.email,
    });
  }

  async verifyOtp(input: VerifyOtpInput): Promise<boolean> {
    const data = this.validate(verifyOtpSchema, input);
    const prefix = data.purpose === "signup" ? OTP_KEY_PREFIX : FORGOT_OTP_KEY_PREFIX;
    const key = `${prefix}${data.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(key, data.otp, MAX_OTP_ATTEMPTS);

      if (outcome === OtpCheckOutcome.Match) {
        return true;
      }

      throw new BusinessError("INVALID_OTP");
    } catch (err: unknown) {
      if (err instanceof BusinessError) {
        throw err;
      }
      this.logger.error("Redis error while checking OTP", {
        action: "auth.verify_otp_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache CHECK_OTP failed", { cause: err });
    }
  }

  async signup(input: SignupInput): Promise<UserResponseDto> {
    const data = this.validate(signupSchema, input);
    const otpKey = `${OTP_KEY_PREFIX}${data.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(otpKey, data.otp, MAX_OTP_ATTEMPTS);

      if (outcome !== OtpCheckOutcome.Match) {
        throw new BusinessError("INVALID_OTP");
      }

      await this.cacheStore.delete(otpKey);
    } catch (err: unknown) {
      if (err instanceof BusinessError) {
        throw err;
      }
      this.logger.error("Redis error during signup OTP verification", {
        action: "auth.signup_otp_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache CHECK_OTP failed", { cause: err });
    }

    const [existingEmail, existingUsername] = await Promise.all([
      this.userRepo.findByEmail(data.email),
      this.userRepo.findByUsername(data.username),
    ]);

    if (existingEmail) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }

    if (existingUsername) {
      throw new BusinessError("USERNAME_TAKEN");
    }

    const passwordHash = await this.hashPassword(data.password);

    try {
      const createdUser = await this.userRepo.create({
        email: data.email,
        username: data.username,
        fullName: data.fullName,
        passwordHash,
        emailVerifiedAt: new Date(),
        isActive: true,
      });

      this.logger.log("User successfully signed up", {
        action: "auth.signed_up",
        userId: createdUser.id,
      });

      return toUserResponse(createdUser);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") {
        const detail = "detail" in err && typeof err.detail === "string" ? err.detail : "";
        const constraint =
          "constraint" in err && typeof err.constraint === "string" ? err.constraint : "";

        if (detail.includes("email") || constraint.includes("email")) {
          throw new BusinessError("USER_ALREADY_EXISTS");
        }
        if (detail.includes("username") || constraint.includes("username")) {
          throw new BusinessError("USERNAME_TAKEN");
        }
      }
      throw err;
    }
  }

  async login(input: LoginInput): Promise<{ tokens: TokenPair; user: UserResponseDto }> {
    const data = this.validate(loginSchema, input);

    const user = await this.userRepo.findByIdentifier(data.identifier);
    if (!user || !user.passwordHash) {
      throw new BusinessError("INVALID_CREDENTIALS");
    }

    const isMatch = await this.verifyPassword(user.passwordHash, data.password);
    if (!isMatch) {
      throw new BusinessError("INVALID_CREDENTIALS");
    }

    if (!user.isActive) {
      throw new BusinessError("FORBIDDEN");
    }

    if (!user.emailVerifiedAt) {
      throw new BusinessError("EMAIL_NOT_VERIFIED");
    }

    const jti = uuidv7();
    const accessToken = await this.jwt.signAccessToken(user.id);
    const refreshToken = await this.jwt.signRefreshToken(user.id, jti);

    try {
      await this.cacheStore.createRefreshSession({
        key: `${REFRESH_TOKEN_KEY_PREFIX}${jti}`,
        sessionKey: `${SESSION_KEY_PREFIX}${user.id}`,
        subject: user.id,
        jti,
        ttlSecs: REFRESH_TOKEN_EXPIRATION,
        maxSessions: MAX_SESSIONS_PER_USER,
      });
    } catch (err: unknown) {
      this.logger.error("Failed to store refresh session in Redis", {
        action: "auth.login_session_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache CREATE_SESSION failed", { cause: err });
    }

    this.logger.log("User successfully logged in", {
      action: "auth.logged_in",
      userId: user.id,
    });

    return {
      tokens: { accessToken, refreshToken },
      user: toUserResponse(user),
    };
  }

  async refreshToken(rawRefreshToken: string): Promise<TokenPair> {
    if (!rawRefreshToken) {
      throw new BusinessError("INVALID_SESSION");
    }

    const payload = await this.jwt.verifyRefreshToken(rawRefreshToken);

    const userId = payload.sub;
    const oldJti = payload.jti;
    const newJti = uuidv7();

    const newAccessToken = await this.jwt.signAccessToken(userId);
    const newRefreshToken = await this.jwt.signRefreshToken(userId, newJti);

    try {
      const outcome = await this.cacheStore.rotateRefreshToken({
        oldKey: `${REFRESH_TOKEN_KEY_PREFIX}${oldJti}`,
        newKey: `${REFRESH_TOKEN_KEY_PREFIX}${newJti}`,
        sessionKey: `${SESSION_KEY_PREFIX}${userId}`,
        subject: userId,
        oldJti,
        newJti,
        ttlSecs: REFRESH_TOKEN_EXPIRATION,
      });

      if (outcome === RotationOutcome.Stale) {
        this.logger.warn("Replay attack detected during refresh rotation", {
          action: "auth.refresh_stale",
          userId,
          oldJti,
        });
        await this.revokeFamily(userId);
        throw new BusinessError("INVALID_SESSION");
      }

      this.logger.log("Refresh token rotated successfully", {
        action: "auth.refreshed",
        userId,
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (err: unknown) {
      if (err instanceof BusinessError) {
        throw err;
      }
      this.logger.error("Redis error during refresh token rotation", {
        action: "auth.rotate_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache ROTATE failed", { cause: err });
    }
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    try {
      const payload = await this.jwt.verifyRefreshToken(rawRefreshToken);

      await this.cacheStore.revokeRefreshSession({
        key: `${REFRESH_TOKEN_KEY_PREFIX}${payload.jti}`,
        sessionKey: `${SESSION_KEY_PREFIX}${payload.sub}`,
        jti: payload.jti,
        ttlSecs: REFRESH_TOKEN_EXPIRATION,
      });

      await this.cacheStore.delete(`${USER_CACHE_KEY_PREFIX}${payload.sub}`);

      this.logger.log("Session revoked on logout", {
        action: "auth.logged_out",
        userId: payload.sub,
      });
    } catch (err: unknown) {
      if (err instanceof CacheError) {
        this.logger.error("Redis failure during session revocation", {
          action: "auth.logout_cache_error",
          err: String(err),
        });
        throw new SystemError("unavailable", "cache REVOKE failed", { cause: err });
      }
    }
  }

  async forgotPasswordOtp(input: ForgotPasswordOtpInput, requestId?: string): Promise<void> {
    const data = this.validate(forgotPasswordOtpSchema, input);

    const user = await this.userRepo.findByEmail(data.email);
    if (!user) {
      this.logger.log("Forgot password OTP requested for non-existent email (anti-enumeration)", {
        action: "auth.forgot_otp_skipped",
      });
      return;
    }

    const code = this.generateOtp();
    const key = `${FORGOT_OTP_KEY_PREFIX}${data.email}`;

    try {
      await this.cacheStore.setRaw(key, JSON.stringify({ code, attempts: 0 }), OTP_EXPIRATION);
    } catch (err: unknown) {
      this.logger.error("Failed to store forgot password OTP in Redis", {
        action: "auth.forgot_otp_cache_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache SET failed", { cause: err });
    }

    await this.mailService.sendOtp({
      to: data.email,
      code,
      purpose: "reset",
      requestId,
    });

    this.logger.log("Forgot password OTP sent", {
      action: "auth.forgot_otp_sent",
      email: data.email,
    });
  }

  async forgotPasswordReset(input: ForgotPasswordResetInput): Promise<void> {
    const data = this.validate(forgotPasswordResetSchema, input);
    const key = `${FORGOT_OTP_KEY_PREFIX}${data.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(key, data.otp, MAX_OTP_ATTEMPTS);

      if (outcome !== OtpCheckOutcome.Match) {
        throw new BusinessError("INVALID_OTP");
      }

      await this.cacheStore.delete(key);
    } catch (err: unknown) {
      if (err instanceof BusinessError) {
        throw err;
      }
      this.logger.error("Redis error checking forgot password OTP", {
        action: "auth.forgot_reset_otp_error",
        err: String(err),
      });
      throw new SystemError("unavailable", "cache CHECK_OTP failed", { cause: err });
    }

    const user = await this.userRepo.findByEmail(data.email);
    if (!user) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    const newHash = await this.hashPassword(data.newPassword);
    await this.userRepo.updatePasswordHash(user.id, newHash);
    await this.revokeFamily(user.id);

    this.logger.log("Password reset successfully", {
      action: "auth.password_reset",
      userId: user.id,
    });
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const data = this.validate(changePasswordSchema, input);

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    if (!user.passwordHash) {
      throw new BusinessError("INVALID_OLD_PASSWORD");
    }

    const isMatch = await this.verifyPassword(user.passwordHash, data.oldPassword);
    if (!isMatch) {
      throw new BusinessError("INVALID_OLD_PASSWORD");
    }

    const newHash = await this.hashPassword(data.newPassword);
    await this.userRepo.updatePasswordHash(userId, newHash);
    await this.revokeFamily(userId);

    this.logger.log("Password changed successfully and sessions revoked", {
      action: "auth.password_changed",
      userId,
    });
  }

  async revokeFamily(userId: string): Promise<void> {
    try {
      const sessionKey = `${SESSION_KEY_PREFIX}${userId}`;
      const rawSessions = await this.cacheStore.getRaw(sessionKey);
      const keysToDelete: string[] = [sessionKey, `${USER_CACHE_KEY_PREFIX}${userId}`];

      if (rawSessions) {
        try {
          const parsed = JSON.parse(rawSessions) as unknown;
          if (Array.isArray(parsed)) {
            for (const jti of parsed) {
              if (typeof jti === "string") {
                keysToDelete.push(`${REFRESH_TOKEN_KEY_PREFIX}${jti}`);
              }
            }
          }
        } catch {
          // ignore corrupted sessions JSON
        }
      }

      await this.cacheStore.deleteMany(keysToDelete);
    } catch (err: unknown) {
      this.logger.error("Failed to revoke session family in Redis", {
        action: "auth.revoke_family_error",
        userId,
        err: String(err),
      });
      throw new SystemError("unavailable", "cache DELETE_MANY failed", { cause: err });
    }
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      hashLength: 32,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private generateOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  private validate<T>(schema: { parse: (val: unknown) => T }, input: unknown): T {
    try {
      return schema.parse(input);
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const message = err.issues[0]?.message;
        if (message) {
          throw BusinessError.validation(message);
        }
        throw new BusinessError("VALIDATION_ERROR");
      }
      throw err;
    }
  }
}
