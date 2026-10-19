import { describe, expect, it } from "vitest";
import { toMessageResponse, toMessageTimeline } from "../../../../src/domain/message/dto/mapper.js";
import type { Message } from "../../../../src/domain/message/schema.js";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversationId: "c1",
    senderId: "u1",
    kind: "TEXT",
    body: "Hello",
    replyToId: null,
    clientMsgId: "client-1",
    editedAt: null,
    deletedAt: null,
    createdAt: new Date("2026-10-18T10:00:00Z"),
    ...overrides,
  };
}

describe("toMessageResponse", () => {
  it("maps visible fields and hides clientMsgId", () => {
    const dto = toMessageResponse(makeMessage());

    expect(dto).toEqual({
      id: "m1",
      conversationId: "c1",
      senderId: "u1",
      kind: "TEXT",
      body: "Hello",
      replyToId: null,
      createdAt: new Date("2026-10-18T10:00:00Z"),
      editedAt: null,
      deletedAt: null,
    });
    expect(dto).not.toHaveProperty("clientMsgId");
  });

  it("nulls body when the message was revoked", () => {
    const deletedAt = new Date("2026-10-18T11:00:00Z");
    const dto = toMessageResponse(makeMessage({ deletedAt }));

    expect(dto.body).toBeNull();
    expect(dto.deletedAt).toBe(deletedAt);
  });

  it("keeps null body for attachment-only messages that are not revoked", () => {
    const dto = toMessageResponse(makeMessage({ kind: "IMAGE", body: null }));

    expect(dto.body).toBeNull();
    expect(dto.deletedAt).toBeNull();
  });
});

describe("toMessageTimeline", () => {
  it("maps items and preserves pagination fields", () => {
    const dto = toMessageTimeline({
      items: [makeMessage(), makeMessage({ id: "m2" })],
      nextCursor: "cursor-1",
      hasMore: true,
    });

    expect(dto.items.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(dto.items[0]).not.toHaveProperty("clientMsgId");
    expect(dto.nextCursor).toBe("cursor-1");
    expect(dto.hasMore).toBe(true);
  });

  it("omits nextCursor when there is no more data", () => {
    const dto = toMessageTimeline({ items: [], hasMore: false });

    expect(dto).not.toHaveProperty("nextCursor");
    expect(dto.hasMore).toBe(false);
  });

  it("nulls revoked bodies inside the timeline", () => {
    const dto = toMessageTimeline({
      items: [makeMessage({ deletedAt: new Date("2026-10-18T11:00:00Z") })],
      hasMore: false,
    });

    expect(dto.items[0].body).toBeNull();
  });
});
