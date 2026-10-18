import { z } from "zod";

export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Invalid email address"),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Username must be at least 3 characters")
      .max(30, "Username must be at most 30 characters")
      .regex(
        /^[a-z0-9_]{3,30}$/,
        "Username must contain only alphanumeric characters and underscores",
      ),
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters")
      .max(100, "Full name must be at most 100 characters"),
    passwordHash: z.string().min(1, "Password hash cannot be empty").optional().nullable(),
    googleId: z.string().min(1).optional().nullable(),
    avatarUrl: z.string().url("Invalid avatar URL").optional().nullable(),
    bio: z.string().max(500, "Bio must be at most 500 characters").optional().nullable(),
    phone: z.string().optional().nullable(),
    emailVerifiedAt: z.coerce.date().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.passwordHash || data.googleId), {
    message: "Tài khoản phải có passwordHash hoặc googleId (đăng nhập bên thứ ba)",
    path: ["passwordHash"],
  });

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name must be at most 100 characters")
    .optional(),
  avatarUrl: z.string().url("Invalid avatar URL").optional().nullable(),
  bio: z.string().max(500, "Bio must be at most 500 characters").optional().nullable(),
  phone: z.string().optional().nullable(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "Old password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const updatePasswordHashSchema = z.object({
  passwordHash: z.string().min(1, "Password hash is required"),
});

export type UpdatePasswordHashDto = z.infer<typeof updatePasswordHashSchema>;
