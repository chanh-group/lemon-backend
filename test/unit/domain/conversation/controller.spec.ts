import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ConversationController } from "../../../../src/domain/conversation/controller.js";
import { ConversationService } from "../../../../src/domain/conversation/service.js";
import type { ConversationWithPartner } from "../../../../src/domain/conversation/repository.js";
import type { AuthUser } from "../../../../src/utils/decorators.js";

describe("ConversationController", () => {
  let controller: ConversationController;
  let getOrCreateDirectMock: Mock<
    (userId: string, targetUserId: string) => Promise<ConversationWithPartner>
  >;
  let listConversationsMock: Mock<
    (userId: string, limit?: number) => Promise<ConversationWithPartner[]>
  >;
  let getByIdMock: Mock<
    (conversationId: string, userId: string) => Promise<ConversationWithPartner>
  >;
  let markAsReadMock: Mock<
    (conversationId: string, userId: string, lastReadMessageId: string) => Promise<void>
  >;

  const mockUser: AuthUser = { id: "0193a2b1-0000-7000-8000-000000000001" };
  const mockPartnerId = "0193a2b1-0000-7000-8000-000000000002";
  const mockConvId = "0193a2b1-0000-7000-8000-000000000010";

  const mockConversation: ConversationWithPartner = {
    id: mockConvId,
    kind: "DIRECT",
    directKey: `${mockUser.id}:${mockPartnerId}`,
    lastMessagePreview: "Hello",
    lastMessageAt: new Date("2026-10-18T10:00:00Z"),
    createdAt: new Date("2026-10-18T09:00:00Z"),
    partner: {
      id: mockPartnerId,
      username: "beta_user",
      fullName: "Beta User",
      avatarUrl: null,
      isOnline: true,
    },
    unreadCount: 1,
  };

  beforeEach(() => {
    getOrCreateDirectMock = vi
      .fn<(userId: string, targetUserId: string) => Promise<ConversationWithPartner>>()
      .mockResolvedValue(mockConversation);

    listConversationsMock = vi
      .fn<(userId: string, limit?: number) => Promise<ConversationWithPartner[]>>()
      .mockResolvedValue([mockConversation]);

    getByIdMock = vi
      .fn<(conversationId: string, userId: string) => Promise<ConversationWithPartner>>()
      .mockResolvedValue(mockConversation);

    markAsReadMock = vi
      .fn<(conversationId: string, userId: string, lastReadMessageId: string) => Promise<void>>()
      .mockResolvedValue(undefined);

    const mockService = {
      getOrCreateDirect: getOrCreateDirectMock,
      listConversations: listConversationsMock,
      getById: getByIdMock,
      markAsRead: markAsReadMock,
    } as unknown as ConversationService;

    controller = new ConversationController(mockService);
  });

  it("POST /conversations/direct - creates or returns a direct conversation", async () => {
    const res = await controller.createDirect(mockUser, { targetUserId: mockPartnerId });

    expect(getOrCreateDirectMock).toHaveBeenCalledWith(mockUser.id, mockPartnerId);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: mockConversation,
    });
  });

  it("GET /conversations - lists user conversations with default limit 20", async () => {
    const res = await controller.listConversations(mockUser, undefined);

    expect(listConversationsMock).toHaveBeenCalledWith(mockUser.id, 20);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: [mockConversation],
    });
  });

  it("GET /conversations - respects query limit param", async () => {
    await controller.listConversations(mockUser, "50");

    expect(listConversationsMock).toHaveBeenCalledWith(mockUser.id, 50);
  });

  it("GET /conversations/:id - gets conversation details", async () => {
    const res = await controller.getConversation(mockUser, mockConvId);

    expect(getByIdMock).toHaveBeenCalledWith(mockConvId, mockUser.id);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: mockConversation,
    });
  });

  it("POST /conversations/:id/read - marks conversation as read", async () => {
    const lastReadMessageId = "0193a2b1-0000-7000-8000-000000000099";
    const res = await controller.markRead(mockUser, mockConvId, { lastReadMessageId });

    expect(markAsReadMock).toHaveBeenCalledWith(mockConvId, mockUser.id, lastReadMessageId);
    expect(res).toEqual({
      success: true,
      message: "OK",
      data: null,
    });
  });
});
