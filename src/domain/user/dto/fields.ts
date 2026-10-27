import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../constants.js";

export const emailSchema = z.string().trim().toLowerCase().email(vmsg("VALIDATION_EMAIL"));

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN_LENGTH, vmsg("VALIDATION_USERNAME_MIN", { min: String(USERNAME_MIN_LENGTH) }))
  .max(USERNAME_MAX_LENGTH, vmsg("VALIDATION_USERNAME_MAX", { max: String(USERNAME_MAX_LENGTH) }))
  .regex(
    new RegExp(`^[a-z0-9_]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`),
    vmsg("VALIDATION_USERNAME_FORMAT"),
  );

export const fullNameSchema = z
  .string()
  .trim()
  .min(
    FULL_NAME_MIN_LENGTH,
    vmsg("VALIDATION_FULL_NAME_MIN", { min: String(FULL_NAME_MIN_LENGTH) }),
  )
  .max(
    FULL_NAME_MAX_LENGTH,
    vmsg("VALIDATION_FULL_NAME_MAX", { max: String(FULL_NAME_MAX_LENGTH) }),
  );
