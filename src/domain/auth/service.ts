import * as crypto from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import * as argon2 from "argon2";
import { v7 as uuidv7 } from "uuid";
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
  ChangePasswordDto,
  ForgotPasswordOtpDto,
  ForgotPasswordResetDto,
  LoginDto,
  RequestOtpDto,
  SignupDto,
  VerifyOtpDto,
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

  async requestOtp(input: RequestOtpDto, requestId?: string): Promise<void> {
    const existingUser = await this.userRepo.findByEmail(input.email);
    if (existingUser) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }

    const code = this.generateOtp();
    const key = `${OTP_KEY_PREFIX}${input.email}`;

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
      to: input.email,
      code,
      purpose: "signup",
      requestId,
    });

    this.logger.log("Registration OTP requested", {
      action: "auth.request_otp",
      email: input.email,
    });
  }

  async verifyOtp(input: VerifyOtpDto): Promise<boolean> {
    const prefix = input.purpose === "signup" ? OTP_KEY_PREFIX : FORGOT_OTP_KEY_PREFIX;
    const key = `${prefix}${input.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(key, input.otp, MAX_OTP_ATTEMPTS);

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

  async signup(input: SignupDto): Promise<UserResponseDto> {
    const otpKey = `${OTP_KEY_PREFIX}${input.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(otpKey, input.otp, MAX_OTP_ATTEMPTS);

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
      this.userRepo.findByEmail(input.email),
      this.userRepo.findByUsername(input.username),
    ]);

    if (existingEmail) {
      throw new BusinessError("USER_ALREADY_EXISTS");
    }

    if (existingUsername) {
      throw new BusinessError("USERNAME_TAKEN");
    }

    const passwordHash = await this.hashPassword(input.password);

    try {
      const createdUser = await this.userRepo.create({
        email: input.email,
        username: input.username,
        fullName: input.fullName,
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

  async login(input: LoginDto): Promise<{ tokens: TokenPair; user: UserResponseDto }> {
    const user = await this.userRepo.findByIdentifier(input.identifier);
    if (!user || !user.passwordHash) {
      throw new BusinessError("INVALID_CREDENTIALS");
    }

    const isMatch = await this.verifyPassword(user.passwordHash, input.password);
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

  async forgotPasswordOtp(input: ForgotPasswordOtpDto, requestId?: string): Promise<void> {
    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      this.logger.log("Forgot password OTP requested for non-existent email (anti-enumeration)", {
        action: "auth.forgot_otp_skipped",
      });
      return;
    }

    const code = this.generateOtp();
    const key = `${FORGOT_OTP_KEY_PREFIX}${input.email}`;

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
      to: input.email,
      code,
      purpose: "reset",
      requestId,
    });

    this.logger.log("Forgot password OTP sent", {
      action: "auth.forgot_otp_sent",
      email: input.email,
    });
  }

  async forgotPasswordReset(input: ForgotPasswordResetDto): Promise<void> {
    const key = `${FORGOT_OTP_KEY_PREFIX}${input.email}`;

    try {
      const outcome = await this.cacheStore.checkOtpCode(key, input.otp, MAX_OTP_ATTEMPTS);

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

    const user = await this.userRepo.findByEmail(input.email);
    if (!user) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    const newHash = await this.hashPassword(input.newPassword);
    await this.userRepo.updatePasswordHash(user.id, newHash);
    await this.revokeFamily(user.id);

    this.logger.log("Password reset successfully", {
      action: "auth.password_reset",
      userId: user.id,
    });
  }

  async changePassword(userId: string, input: ChangePasswordDto): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessError("USER_NOT_FOUND");
    }

    if (!user.passwordHash) {
      throw new BusinessError("INVALID_OLD_PASSWORD");
    }

    const isMatch = await this.verifyPassword(user.passwordHash, input.oldPassword);
    if (!isMatch) {
      throw new BusinessError("INVALID_OLD_PASSWORD");
    }

    const newHash = await this.hashPassword(input.newPassword);
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
}
