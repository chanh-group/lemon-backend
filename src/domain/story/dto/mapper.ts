import type { Story } from "../schema.js";
import type { UserSummary } from "../../user/dto/response.js";
import type { StoryReactionKind } from "../constants.js";
import { isUuid } from "../../shared.js";
import type { StoryItemResponse, StoryPreview, UserStoryFeedResponse } from "./response.js";

export { isUuid } from "../../shared.js";

export function toStoryPreview(story: Story): StoryPreview {
  return {
    id: story.id,
    kind: story.kind,
    bucket: story.bucket,
    objectKey: story.objectKey,
    caption: story.caption,
    background: story.background,
  };
}

export function toStoryItemResponse(
  story: Story,
  hasViewed?: boolean,
  myReaction?: string | null,
  reactionsCount?: number,
  myReactionKind?: StoryReactionKind | null,
): StoryItemResponse {
  return {
    id: story.id,
    userId: story.userId,
    kind: story.kind,
    bucket: story.bucket,
    objectKey: story.objectKey,
    mimeType: story.mimeType,
    width: story.width,
    height: story.height,
    durationMs: story.durationMs,
    caption: story.caption,
    background: story.background,
    allowReplies: story.allowReplies,
    allowReactions: story.allowReactions,
    audienceMode: story.audienceMode,
    archivedAt: story.archivedAt ?? null,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    ...(hasViewed !== undefined && { hasViewed }),
    ...(myReaction !== undefined && { myReaction }),
    ...(myReactionKind !== undefined && { myReactionKind }),
    ...(reactionsCount !== undefined && { reactionsCount }),
  };
}

/**
 * Revive `Date` fields after a JSON cache round-trip (JSON has no Date type —
 * `createdAt`/`expiresAt` come back as ISO strings). Safe to call on fresh
 * (non-cached) feeds too: `new Date(date)` copies.
 */
export function reviveUserStoryFeed(feed: UserStoryFeedResponse[]): UserStoryFeedResponse[] {
  return feed.map((entry) => ({
    ...entry,
    stories: entry.stories.map((story) => ({
      ...story,
      createdAt: new Date(story.createdAt),
      expiresAt: new Date(story.expiresAt),
      archivedAt: story.archivedAt ? new Date(story.archivedAt) : null,
    })),
  }));
}

export function groupStoriesByUser(
  usersMap: Map<string, UserSummary>,
  stories: Story[],
  viewedStoryIds: Set<string>,
  userReactionsMap?: Map<string, { emoji: string; kind: StoryReactionKind } | string>,
): UserStoryFeedResponse[] {
  const userStoriesMap = new Map<string, StoryItemResponse[]>();

  for (const story of stories) {
    const list = userStoriesMap.get(story.userId) ?? [];
    const reactionInfo = userReactionsMap?.get(story.id);
    const emoji = typeof reactionInfo === "string" ? reactionInfo : (reactionInfo?.emoji ?? null);
    const kind = typeof reactionInfo === "object" ? reactionInfo.kind : null;

    list.push(toStoryItemResponse(story, viewedStoryIds.has(story.id), emoji, undefined, kind));
    userStoriesMap.set(story.userId, list);
  }

  const result: UserStoryFeedResponse[] = [];
  for (const [userId, userStories] of userStoriesMap.entries()) {
    const user = usersMap.get(userId) ?? {
      id: userId,
      username: "user",
      fullName: "User",
      avatarUrl: null,
    };
    // Sort chronological: oldest to newest for viewing experience
    userStories.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    result.push({
      user,
      stories: userStories,
    });
  }

  return result;
}

export function encodeReactionCursor(createdAt: Date, userId: string): string {
  return Buffer.from(`${createdAt.getTime()}_${userId}`).toString("base64url");
}

export function decodeReactionCursor(cursor: string): { createdAt: Date; userId: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf-8");
    const idx = raw.indexOf("_");
    if (idx === -1) return null;
    const msStr = raw.slice(0, idx);
    const userId = raw.slice(idx + 1);
    const ms = Number(msStr);
    if (!Number.isSafeInteger(ms) || ms <= 0) return null;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    if (!isUuid(userId)) return null;
    return { createdAt: date, userId };
  } catch {
    return null;
  }
}
