import type { Story } from "../schema.js";
import type { UserSummary } from "../../user/dto/response.js";
import type { StoryItemResponse, UserStoryFeedResponse } from "./response.js";

export function toStoryItemResponse(story: Story, hasViewed?: boolean): StoryItemResponse {
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
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    ...(hasViewed !== undefined && { hasViewed }),
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
    })),
  }));
}

export function groupStoriesByUser(
  usersMap: Map<string, UserSummary>,
  stories: Story[],
  viewedStoryIds: Set<string>,
): UserStoryFeedResponse[] {
  const userStoriesMap = new Map<string, StoryItemResponse[]>();

  for (const story of stories) {
    const list = userStoriesMap.get(story.userId) ?? [];
    list.push(toStoryItemResponse(story, viewedStoryIds.has(story.id)));
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
