import type { MessageTimelineResult, MessageWithAttachments } from "../repository.js";
import type { MessageAttachment } from "../schema.js";
import type { StorageService } from "../../../utils/storage/store.js";
import type {
  MessageAttachmentResponse,
  MessageReactionSummary,
  MessageResponse,
  MessageTimelineResponse,
} from "./response.js";

export async function mapAttachmentsToResponse(
  attachments: MessageAttachment[] | undefined,
  storage?: StorageService,
): Promise<MessageAttachmentResponse[] | undefined> {
  if (!attachments || attachments.length === 0) return undefined;
  if (!storage) {
    return attachments.map((att) => ({
      id: att.id,
      objectKey: att.objectKey,
      kind: att.kind,
      fileName: att.fileName,
      mimeType: att.mimeType,
      sizeBytes: Number(att.sizeBytes),
      width: att.width,
      height: att.height,
      durationMs: att.durationMs,
      previewUrl: "",
      downloadUrl: "",
    }));
  }

  return await Promise.all(
    attachments.map(async (att) => {
      try {
        const [{ downloadUrl: previewUrl }, { downloadUrl }] = await Promise.all([
          storage.presignGet({
            objectKey: att.objectKey,
            fileName: att.fileName,
            disposition: "inline",
            mimeType: att.mimeType,
            expiresInSecs: 86400,
          }),
          storage.presignGet({
            objectKey: att.objectKey,
            fileName: att.fileName,
            disposition: "attachment",
            mimeType: att.mimeType,
            expiresInSecs: 86400,
          }),
        ]);
        return {
          id: att.id,
          objectKey: att.objectKey,
          kind: att.kind,
          fileName: att.fileName,
          mimeType: att.mimeType,
          sizeBytes: Number(att.sizeBytes),
          width: att.width,
          height: att.height,
          durationMs: att.durationMs,
          previewUrl,
          downloadUrl,
        };
      } catch {
        return {
          id: att.id,
          objectKey: att.objectKey,
          kind: att.kind,
          fileName: att.fileName,
          mimeType: att.mimeType,
          sizeBytes: Number(att.sizeBytes),
          width: att.width,
          height: att.height,
          durationMs: att.durationMs,
          previewUrl: "",
          downloadUrl: "",
        };
      }
    }),
  );
}

export function groupReactions(
  reactions?: { emoji: string; userId: string }[],
): MessageReactionSummary[] | undefined {
  if (!reactions || reactions.length === 0) return undefined;
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    const list = map.get(r.emoji) ?? [];
    list.push(r.userId);
    map.set(r.emoji, list);
  }
  return Array.from(map.entries()).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    userIds,
  }));
}

export function toMessageResponse(
  message: MessageWithAttachments,
  attachments?: MessageAttachmentResponse[],
): MessageResponse {
  const reactions = groupReactions(message.reactions);
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    kind: message.kind,
    body: message.deletedAt ? null : message.body,
    replyToId: message.replyToId,
    storyId: message.storyId ?? null,
    storyPreview: message.storyPreview ?? null,
    ...(attachments && { attachments }),
    ...(reactions && { reactions }),
    ...(message.isForwarded && { isForwarded: true }),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
  };
}

export async function toMessageResponseAsync(
  message: MessageWithAttachments,
  storage?: StorageService,
): Promise<MessageResponse> {
  const attachments = await mapAttachmentsToResponse(message.attachments, storage);
  return toMessageResponse(message, attachments);
}

export async function toMessageTimelineAsync(
  result: MessageTimelineResult,
  storage?: StorageService,
): Promise<MessageTimelineResponse> {
  const items = await Promise.all(result.items.map((m) => toMessageResponseAsync(m, storage)));
  return {
    items,
    ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    hasMore: result.hasMore,
  };
}

export function toMessageTimeline(result: MessageTimelineResult): MessageTimelineResponse {
  return {
    items: result.items.map((m) => toMessageResponse(m)),
    ...(result.nextCursor !== undefined && { nextCursor: result.nextCursor }),
    hasMore: result.hasMore,
  };
}
