import { Inject, Injectable } from "@nestjs/common";
import { CACHE_STORE, type CacheStoreExt } from "../../utils/cache/store.js";
import { noteFeedKey, storyFeedKey } from "../../utils/cache/keys.js";
import { BusinessError } from "../../utils/errors/business.js";
import { USER_REPOSITORY, type UserRepository } from "../user/repository.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { FRIEND_REPOSITORY, type FriendRepository } from "./repository.js";

@Injectable()
export class FriendService {
  constructor(
    @Inject(FRIEND_REPOSITORY) private readonly friendRepo: FriendRepository,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    private readonly realtimeService: RealtimeService,
    @Inject(CACHE_STORE) private readonly cache: CacheStoreExt,
  ) {}

  async sendRequest(requesterId: string, addresseeId: string): Promise<void> {
    if (!addresseeId || requesterId === addresseeId) {
      throw new BusinessError(
        requesterId === addresseeId ? "CANNOT_CHAT_WITH_SELF" : "BAD_REQUEST",
      );
    }
    const [addressee, requester] = await Promise.all([
      this.userRepo.findById(addresseeId),
      this.userRepo.findById(requesterId),
    ]);
    if (!addressee) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    if (!requester) throw new BusinessError("USER_NOT_FOUND");

    const existing = await this.friendRepo.findByPair(requesterId, addresseeId);
    if (existing) {
      if (existing.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
      if (existing.status === "ACCEPTED") throw new BusinessError("ALREADY_FRIENDS");
      throw new BusinessError("FRIEND_REQUEST_EXISTS");
    }

    const result = await this.friendRepo.createRequest(requesterId, addresseeId);
    const request = result.friendship;
    if (request.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
    if (request.status === "ACCEPTED") throw new BusinessError("ALREADY_FRIENDS");
    if (!result.created || request.requesterId !== requesterId) {
      throw new BusinessError("FRIEND_REQUEST_EXISTS");
    }

    this.realtimeService.emitFriendRequestReceived(addresseeId, {
      id: request.id,
      user: {
        id: requesterId,
        name: requester.fullName,
        username: requester.username,
      },
    });
  }

  listRequestsPage(
    userId: string,
    incomingCursor: string | undefined,
    outgoingCursor: string | undefined,
    limit: number,
  ) {
    return this.friendRepo.listRequestsPage(userId, incomingCursor, outgoingCursor, limit);
  }

  listFriendsPage(userId: string, cursor: string | undefined, limit: number) {
    return this.friendRepo.listFriendsPage(userId, cursor, limit);
  }

  findAcceptedFriendIds(userId: string, candidates: string[]) {
    return this.friendRepo.findAcceptedFriendIds(userId, candidates);
  }

  async acceptRequest(requestId: string, userId: string): Promise<void> {
    const accepted = await this.friendRepo.acceptRequest(requestId, userId);
    if (!accepted) {
      throw new BusinessError("FRIEND_REQUEST_NOT_FOUND");
    }
    await this.invalidateSocialFeeds(accepted.requesterId, accepted.addresseeId);
  }

  async declineRequest(requestId: string, userId: string): Promise<void> {
    if (!(await this.friendRepo.deleteIncomingRequest(requestId, userId))) {
      throw new BusinessError("FRIEND_REQUEST_NOT_FOUND");
    }
  }

  async cancelRequest(requestId: string, userId: string): Promise<void> {
    if (!(await this.friendRepo.deleteOutgoingRequest(requestId, userId))) {
      throw new BusinessError("FRIEND_REQUEST_NOT_FOUND");
    }
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    if (userId === friendId) throw new BusinessError("BAD_REQUEST");
    if (!(await this.friendRepo.deleteAcceptedPair(userId, friendId))) {
      throw new BusinessError("NOT_FOUND");
    }
    await this.invalidateSocialFeeds(userId, friendId);
  }

  async blockUser(blockerId: string, targetId: string): Promise<void> {
    if (blockerId === targetId) throw new BusinessError("BAD_REQUEST");
    if (!(await this.userRepo.findById(targetId))) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    await this.friendRepo.blockPair(blockerId, targetId);
    await this.invalidateSocialFeeds(blockerId, targetId);
  }

  private async invalidateSocialFeeds(userAId: string, userBId: string): Promise<void> {
    await this.cache.deleteManyBestEffort([
      storyFeedKey(userAId),
      storyFeedKey(userBId),
      noteFeedKey(userAId),
      noteFeedKey(userBId),
    ]);
  }

  async assertCanChat(userId: string, targetId: string): Promise<void> {
    const relation = await this.friendRepo.findByPair(userId, targetId);
    if (relation?.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
    if (relation?.status !== "ACCEPTED") throw new BusinessError("FRIENDSHIP_REQUIRED");
  }
}
