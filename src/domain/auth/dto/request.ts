import { z } from "zod";

export const requestOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
});
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
export type RequestOtpInput = z.input<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Mã OTP phải gồm đúng 6 chữ số"),
  purpose: z.enum(["signup", "reset"]).default("signup"),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  fullName: z
    .string()
    .trim()
    .min(2, "Họ và tên phải có ít nhất 2 ký tự")
    .max(100, "Họ và tên tối đa 100 ký tự"),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Tên đăng nhập phải có ít nhất 3 ký tự")
    .max(30, "Tên đăng nhập tối đa 30 ký tự")
    .regex(/^[a-z0-9_]{3,30}$/, "Tên đăng nhập chỉ được chứa chữ cái thường, số và dấu gạch dưới"),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Mã OTP phải gồm đúng 6 chữ số"),
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
    identifier: z.string().trim().min(1, "Vui lòng nhập email hoặc tên đăng nhập"),
    password: z.string().min(1, "Vui lòng nhập mật khẩu"),
  }),
);
export type LoginDto = z.infer<typeof loginSchema>;
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
});
export type ForgotPasswordOtpDto = z.infer<typeof forgotPasswordOtpSchema>;
export type ForgotPasswordOtpInput = z.input<typeof forgotPasswordOtpSchema>;

export const forgotPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Mã OTP phải gồm đúng 6 chữ số"),
  newPassword: z.string().min(6, "Mật khẩu mới phải có ít nhất 6 ký tự"),
});
export type ForgotPasswordResetDto = z.infer<typeof forgotPasswordResetSchema>;
export type ForgotPasswordResetInput = z.input<typeof forgotPasswordResetSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Mật khẩu cũ không được để trống"),
  newPassword: z.string().min(6, "Mật khẩu mới phải có ít nhất 6 ký tự"),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
