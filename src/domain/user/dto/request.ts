import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  USER_BIO_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../constants.js";

export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL")),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(
        USERNAME_MIN_LENGTH,
        vmsg("VALIDATION_USERNAME_MIN", { min: String(USERNAME_MIN_LENGTH) }),
      )
      .max(
        USERNAME_MAX_LENGTH,
        vmsg("VALIDATION_USERNAME_MAX", { max: String(USERNAME_MAX_LENGTH) }),
      )
      .regex(
        new RegExp(`^[a-z0-9_]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`),
        vmsg("VALIDATION_USERNAME_FORMAT"),
      ),
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
    )
    .optional(),
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
