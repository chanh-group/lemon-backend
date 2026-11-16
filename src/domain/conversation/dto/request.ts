import { z } from "zod";
import { vmsg } from "../../../utils/validation.js";
import {
  GROUP_MAX_NAME_LENGTH,
  GROUP_MAX_MEMBERS,
  GROUP_MIN_INVITED_MEMBERS,
} from "../constants.js";

export const createDirectSchema = z.object({
  targetUserId: z.string().uuid(vmsg("VALIDATION_UUID_TARGET_USER")),
});

export type CreateDirectDto = z.infer<typeof createDirectSchema>;

export const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(GROUP_MAX_NAME_LENGTH),
  memberIds: z
    .array(z.string().uuid())
    .min(GROUP_MIN_INVITED_MEMBERS)
    .max(GROUP_MAX_MEMBERS - 1),
  clientRequestId: z.string().uuid(),
});
export type CreateGroupDto = z.infer<typeof createGroupSchema>;

export const addGroupMembersSchema = z.object({
  memberIds: z
    .array(z.string().uuid())
    .min(1)
    .max(GROUP_MAX_MEMBERS - 1),
});
export type AddGroupMembersDto = z.infer<typeof addGroupMembersSchema>;

export const updateGroupSchema = z.object({
  title: z.string().trim().min(1).max(GROUP_MAX_NAME_LENGTH).optional(),
});
export type UpdateGroupDto = z.infer<typeof updateGroupSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]),
});
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;

export const transferOwnershipSchema = z.object({ userId: z.string().uuid() });
export type TransferOwnershipDto = z.infer<typeof transferOwnershipSchema>;

export const markReadSchema = z.object({
  lastReadMessageId: z.string().uuid(vmsg("VALIDATION_UUID_LAST_READ")),
});

export type MarkReadDto = z.infer<typeof markReadSchema>;
