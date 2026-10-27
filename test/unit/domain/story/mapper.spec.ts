import { describe, expect, it } from "vitest";
import {
  decodeReactionCursor,
  encodeReactionCursor,
  groupStoriesByUser,
  isUuid,
  toStoryItemResponse,
} from "../../../../src/domain/story/dto/mapper.js";
import type { Story } from "../../../../src/domain/story/schema.js";
import type { UserSummary } from "../../../../src/domain/user/dto/response.js";

function makeStory(overrides: Partial<Story> & { id: string; userId: string }): Story {
  return {
    kind: "IMAGE",
    bucket: "lemon-stories",
    objectKey: "stories/u/a.jpg",
    mimeType: "image/jpeg",
    width: 1080,
    height: 1920,
    durationMs: null,
    caption: null,
    background: null,
    allowReplies: true,
    allowReactions: true,
    audienceMode: "ALL_FRIENDS",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("toStoryItemResponse", () => {
  it("maps every Story field", () => {
    const item = toStoryItemResponse(makeStory({ id: "s1", userId: "u1" }), true);

    expect(item).toEqual({
      id: "s1",
      userId: "u1",
      kind: "IMAGE",
      bucket: "lemon-stories",
      objectKey: "stories/u/a.jpg",
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
      durationMs: null,
      caption: null,
      background: null,
      allowReplies: true,
      allowReactions: true,
      audienceMode: "ALL_FRIENDS",
      archivedAt: null,
      createdAt: new Date("2026-10-14T00:00:00Z"),
      expiresAt: new Date("2026-10-15T00:00:00Z"),
      hasViewed: true,
    });
  });

  it("omits hasViewed when not provided", () => {
    const item = toStoryItemResponse(makeStory({ id: "s1", userId: "u1" }));

    expect(item).not.toHaveProperty("hasViewed");
    expect(item).not.toHaveProperty("myReaction");
    expect(item).not.toHaveProperty("reactionsCount");
  });

  it("includes myReaction and reactionsCount when provided", () => {
    const item = toStoryItemResponse(makeStory({ id: "s1", userId: "u1" }), false, "❤️", 5, "LIKE");

    expect(item.myReaction).toBe("❤️");
    expect(item.reactionsCount).toBe(5);
    expect(item.myReactionKind).toBe("LIKE");
  });
});

describe("groupStoriesByUser", () => {
  const users = new Map<string, UserSummary>([
    ["u1", { id: "u1", username: "one", fullName: "User One", avatarUrl: null }],
  ]);

  it("groups stories by author and flags viewed ones", () => {
    const feed = groupStoriesByUser(
      users,
      [
        makeStory({ id: "s1", userId: "u1" }),
        makeStory({ id: "s2", userId: "u1", createdAt: new Date("2026-10-14T01:00:00Z") }),
      ],
      new Set(["s2"]),
    );

    expect(feed).toHaveLength(1);
    expect(feed[0].stories.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(feed[0].stories.map((s) => s.hasViewed)).toEqual([false, true]);
  });

  it("sorts each author's stories oldest to newest", () => {
    const feed = groupStoriesByUser(
      users,
      [
        makeStory({ id: "new", userId: "u1", createdAt: new Date("2026-10-14T02:00:00Z") }),
        makeStory({ id: "old", userId: "u1", createdAt: new Date("2026-10-14T00:00:00Z") }),
      ],
      new Set(),
    );

    expect(feed[0].stories.map((s) => s.id)).toEqual(["old", "new"]);
  });

  it("omits stories whose author is no longer available", () => {
    const feed = groupStoriesByUser(users, [makeStory({ id: "s9", userId: "ghost" })], new Set());

    expect(feed).toEqual([]);
  });

  it("populates myReaction from the lookup map and leaves the global count out", () => {
    const userReactions = new Map([["s1", { emoji: "🔥", kind: "REACTION" as const }]]);

    const feed = groupStoriesByUser(
      users,
      [makeStory({ id: "s1", userId: "u1" })],
      new Set(),
      userReactions,
    );

    expect(feed[0].stories[0].myReaction).toBe("🔥");
    expect(feed[0].stories[0].myReactionKind).toBe("REACTION");
    expect(feed[0].stories[0]).not.toHaveProperty("reactionsCount");
  });
});

describe("encodeReactionCursor & decodeReactionCursor", () => {
  it("encodes and decodes createdAt + userId roundtrip", () => {
    const createdAt = new Date("2026-10-24T18:00:00.000Z");
    const userId = "0193a2b1-0000-7000-8000-000000000001";
    const encoded = encodeReactionCursor(createdAt, userId);

    expect(typeof encoded).toBe("string");
    expect(encoded).not.toContain(":");

    const decoded = decodeReactionCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.getTime()).toBe(createdAt.getTime());
    expect(decoded?.userId).toBe(userId);
  });

  it("returns null on malformed cursor string", () => {
    expect(decodeReactionCursor("invalid")).toBeNull();
    expect(decodeReactionCursor("")).toBeNull();
    expect(decodeReactionCursor("not_a_valid_base64url!!")).toBeNull();
  });

  it("returns null when decoded userId is not a valid UUID", () => {
    const invalidUserCursor = Buffer.from("1792843195317_not-a-uuid").toString("base64url");
    expect(decodeReactionCursor(invalidUserCursor)).toBeNull();
  });

  it("returns null when timestamp is invalid or non-positive", () => {
    const nanCursor = Buffer.from("NaN_0193a2b1-0000-7000-8000-000000000001").toString("base64url");
    const negCursor = Buffer.from("-100_0193a2b1-0000-7000-8000-000000000001").toString(
      "base64url",
    );
    const zeroCursor = Buffer.from("0_0193a2b1-0000-7000-8000-000000000001").toString("base64url");
    expect(decodeReactionCursor(nanCursor)).toBeNull();
    expect(decodeReactionCursor(negCursor)).toBeNull();
    expect(decodeReactionCursor(zeroCursor)).toBeNull();
  });

  it("validates UUID strings using isUuid", () => {
    expect(isUuid("0193a2b1-0000-7000-8000-000000000001")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
