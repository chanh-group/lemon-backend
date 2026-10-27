import type { MessageTimelineResult, MessageWithAttachments } from "../repository.js";
import type { MessageAttachment } from "../schema.js";
import type { StorageService } from "../../../utils/storage/store.js";
import type {
  MessageAttachmentResponse,
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
          }),
          storage.presignGet({
            objectKey: att.objectKey,
            fileName: att.fileName,
            disposition: "attachment",
            mimeType: att.mimeType,
          }),
        ]);
        return {
          id: att.id,
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

export function toMessageResponse(
  message: MessageWithAttachments,
  attachments?: MessageAttachmentResponse[],
): MessageResponse {
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
