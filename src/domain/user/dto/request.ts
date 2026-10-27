import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import { USER_BIO_MAX_LENGTH } from "../constants.js";
import { emailSchema, fullNameSchema, usernameSchema } from "./fields.js";

export const createUserSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    fullName: fullNameSchema,
    passwordHash: z
      .string()
      .min(1, vmsg("VALIDATION_PASSWORD_HASH_REQUIRED"))
      .optional()
      .nullable(),
    googleId: z.string().min(1).optional().nullable(),
    avatarUrl: z.string().url(vmsg("VALIDATION_URL")).optional().nullable(),
    bio: z
      .string()
      .max(USER_BIO_MAX_LENGTH, vmsg("VALIDATION_BIO_MAX", { max: String(USER_BIO_MAX_LENGTH) }))
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
  fullName: fullNameSchema.optional(),
  avatarUrl: z.string().url(vmsg("VALIDATION_URL")).optional().nullable(),
  bio: z
    .string()
    .max(USER_BIO_MAX_LENGTH, vmsg("VALIDATION_BIO_MAX", { max: String(USER_BIO_MAX_LENGTH) }))
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
