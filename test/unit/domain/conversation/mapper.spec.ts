import { describe, expect, it } from "vitest";
import { toConversationResponse } from "../../../../src/domain/conversation/dto/mapper.js";
import type { ConversationWithPartner } from "../../../../src/domain/conversation/repository.js";

function makeConversation(
  overrides: Partial<ConversationWithPartner> = {},
): ConversationWithPartner {
  return {
    id: "c1",
    kind: "DIRECT",
    directKey: "u1:u2",
    lastMessagePreview: "Hello",
    lastMessageAt: new Date("2026-10-18T10:00:00Z"),
    createdAt: new Date("2026-10-18T09:00:00Z"),
    partner: {
      id: "u2",
      username: "beta",
      fullName: "Beta",
      avatarUrl: null,
      isOnline: true,
    },
    unreadCount: 5,
    lastReadMessageId: "m1",
    ...overrides,
  };
}

describe("toConversationResponse", () => {
  it("maps visible fields and hides directKey and lastReadMessageId", () => {
    const dto = toConversationResponse(makeConversation());

    expect(dto).toEqual({
      id: "c1",
      kind: "DIRECT",
      partner: {
        id: "u2",
        username: "beta",
        fullName: "Beta",
        avatarUrl: null,
        isOnline: true,
      },
      lastMessagePreview: "Hello",
      lastMessageAt: new Date("2026-10-18T10:00:00Z"),
      unreadCount: 5,
      createdAt: new Date("2026-10-18T09:00:00Z"),
    });
    expect(dto).not.toHaveProperty("directKey");
    expect(dto).not.toHaveProperty("lastReadMessageId");
  });

  it("defaults unreadCount to 0 when missing", () => {
    const dto = toConversationResponse(makeConversation({ unreadCount: undefined }));

    expect(dto.unreadCount).toBe(0);
  });

  it("defaults partner.isOnline to false when missing", () => {
    const dto = toConversationResponse(
      makeConversation({
        partner: { id: "u2", username: "beta", fullName: "Beta", avatarUrl: null },
      }),
    );

    expect(dto.partner?.isOnline).toBe(false);
  });

  it("omits partner entirely when the conversation has none", () => {
    const dto = toConversationResponse(makeConversation({ partner: undefined }));

    expect(dto).not.toHaveProperty("partner");
  });

  it("maps group conversations without a partner", () => {
    const dto = toConversationResponse(
      makeConversation({ kind: "GROUP", directKey: null, partner: undefined }),
    );

    expect(dto.kind).toBe("GROUP");
    expect(dto.partner).toBeUndefined();
  });
});
