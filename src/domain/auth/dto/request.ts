import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../../user/constants.js";

export const requestOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
});
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
export type RequestOtpInput = z.input<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, vmsg("VALIDATION_OTP_FORMAT")),
  purpose: z.enum(["signup", "reset"]).default("signup"),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
  fullName: z
    .string()
    .trim()
    .min(
      FULL_NAME_MIN_LENGTH,
      vmsg("VALIDATION_FULL_NAME_MIN", { min: String(FULL_NAME_MIN_LENGTH) }),
    )
    .max(
      FULL_NAME_MAX_LENGTH,
      vmsg("VALIDATION_FULL_NAME_MAX", { max: String(FULL_NAME_MAX_LENGTH) }),
    ),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(USERNAME_MIN_LENGTH, vmsg("VALIDATION_USERNAME_MIN", { min: String(USERNAME_MIN_LENGTH) }))
    .max(USERNAME_MAX_LENGTH, vmsg("VALIDATION_USERNAME_MAX", { max: String(USERNAME_MAX_LENGTH) }))
    .regex(
      new RegExp(`^[a-z0-9_]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`),
      vmsg("VALIDATION_USERNAME_FORMAT"),
    ),
  password: z.string().min(6, vmsg("VALIDATION_PASSWORD_MIN", { min: "6" })),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, vmsg("VALIDATION_OTP_FORMAT")),
});
export type SignupDto = z.infer<typeof signupSchema>;
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === "object" && !("identifier" in val) && "email" in val) {
      return { ...val, identifier: (val as { email: unknown }).email };
    }
    return val;
  },
  z.object({
    identifier: z.string().trim().min(1, vmsg("VALIDATION_IDENTIFIER_REQUIRED")),
    password: z.string().min(1, vmsg("VALIDATION_PASSWORD_REQUIRED")),
  }),
);
export type LoginDto = z.infer<typeof loginSchema>;
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
});
export type ForgotPasswordOtpDto = z.infer<typeof forgotPasswordOtpSchema>;
export type ForgotPasswordOtpInput = z.input<typeof forgotPasswordOtpSchema>;

export const forgotPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, vmsg("VALIDATION_OTP_FORMAT")),
  newPassword: z.string().min(6, vmsg("VALIDATION_NEW_PASSWORD_MIN", { min: "6" })),
});
export type ForgotPasswordResetDto = z.infer<typeof forgotPasswordResetSchema>;
export type ForgotPasswordResetInput = z.input<typeof forgotPasswordResetSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, vmsg("VALIDATION_OLD_PASSWORD_REQUIRED")),
  newPassword: z.string().min(6, vmsg("VALIDATION_NEW_PASSWORD_MIN", { min: "6" })),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
