import { describe, expect, it } from "vitest";
import {
  groupStoriesByUser,
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
    createdAt: new Date("2026-10-14T00:00:00Z"),
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    deletedAt: null,
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
    const item = toStoryItemResponse(makeStory({ id: "s1", userId: "u1" }), false, "❤️", 5);

    expect(item.myReaction).toBe("❤️");
    expect(item.reactionsCount).toBe(5);
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

  it("falls back to a placeholder profile for unknown users", () => {
    const feed = groupStoriesByUser(users, [makeStory({ id: "s9", userId: "ghost" })], new Set());

    expect(feed[0].user.id).toBe("ghost");
    expect(feed[0].stories).toHaveLength(1);
  });

  it("populates myReaction from the lookup map and leaves the global count out", () => {
    const userReactions = new Map([["s1", "🔥"]]);

    const feed = groupStoriesByUser(
      users,
      [makeStory({ id: "s1", userId: "u1" })],
      new Set(),
      userReactions,
    );

    expect(feed[0].stories[0].myReaction).toBe("🔥");
    expect(feed[0].stories[0]).not.toHaveProperty("reactionsCount");
  });
});
