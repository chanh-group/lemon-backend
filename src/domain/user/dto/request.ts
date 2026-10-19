import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";

export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, vmsg("VALIDATION_USERNAME_MIN", { min: "3" }))
      .max(30, vmsg("VALIDATION_USERNAME_MAX", { max: "30" }))
      .regex(/^[a-z0-9_]{3,30}$/, vmsg("VALIDATION_USERNAME_FORMAT")),
    fullName: z
      .string()
      .trim()
      .min(2, vmsg("VALIDATION_FULL_NAME_MIN", { min: "2" }))
      .max(100, vmsg("VALIDATION_FULL_NAME_MAX", { max: "100" })),
    passwordHash: z
      .string()
      .min(1, vmsg("VALIDATION_PASSWORD_HASH_REQUIRED"))
      .optional()
      .nullable(),
    googleId: z.string().min(1).optional().nullable(),
    avatarUrl: z.string().url(vmsg("VALIDATION_URL")).optional().nullable(),
    bio: z
      .string()
      .max(500, vmsg("VALIDATION_BIO_MAX", { max: "500" }))
      .optional()
      .nullable(),
    phone: z.string().optional().nullable(),
    emailVerifiedAt: z.coerce.date().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.passwordHash || data.googleId), {
    message: vmsg("VALIDATION_ACCOUNT_CREDENTIALS_REQUIRED"),
    path: ["passwordHash"],
  });

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, vmsg("VALIDATION_FULL_NAME_MIN", { min: "2" }))
    .max(100, vmsg("VALIDATION_FULL_NAME_MAX", { max: "100" }))
    .optional(),
  avatarUrl: z.string().url(vmsg("VALIDATION_URL")).optional().nullable(),
  bio: z
    .string()
    .max(500, vmsg("VALIDATION_BIO_MAX", { max: "500" }))
    .optional()
    .nullable(),
  phone: z.string().optional().nullable(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, vmsg("VALIDATION_OLD_PASSWORD_REQUIRED")),
  newPassword: z.string().min(6, vmsg("VALIDATION_NEW_PASSWORD_MIN", { min: "6" })),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const updatePasswordHashSchema = z.object({
  passwordHash: z.string().min(1, vmsg("VALIDATION_PASSWORD_HASH_REQUIRED")),
});

export type UpdatePasswordHashDto = z.infer<typeof updatePasswordHashSchema>;
