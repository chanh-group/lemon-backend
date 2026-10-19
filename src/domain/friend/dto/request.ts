import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";

export const friendRequestSchema = z.object({
  userId: z.string().uuid(vmsg("VALIDATION_UUID_FRIEND_USER")),
});
