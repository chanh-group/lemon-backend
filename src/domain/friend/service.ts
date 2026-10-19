import { Inject, Injectable } from "@nestjs/common";
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
  ) {}

  async sendRequest(requesterId: string, addresseeId: string): Promise<void> {
    if (!addresseeId || requesterId === addresseeId) {
      throw new BusinessError(requesterId === addresseeId ? "CANNOT_CHAT_WITH_SELF" : "BAD_REQUEST");
    }
    const addressee = await this.userRepo.findById(addresseeId);
    if (!addressee) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    const requester = await this.userRepo.findById(requesterId);
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

  listRequests(userId: string) {
    return this.friendRepo.listRequests(userId);
  }

  listFriends(userId: string) {
    return this.friendRepo.listFriends(userId);
  }

  async acceptRequest(requestId: string, userId: string): Promise<void> {
    if (!(await this.friendRepo.acceptRequest(requestId, userId))) {
      throw new BusinessError("FRIEND_REQUEST_NOT_FOUND");
    }
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
  }

  async blockUser(blockerId: string, targetId: string): Promise<void> {
    if (blockerId === targetId) throw new BusinessError("BAD_REQUEST");
    if (!(await this.userRepo.findById(targetId))) {
      throw new BusinessError("USER_NOT_FOUND");
    }
    await this.friendRepo.blockPair(blockerId, targetId);
  }

  async assertCanChat(userId: string, targetId: string): Promise<void> {
    const relation = await this.friendRepo.findByPair(userId, targetId);
    if (relation?.status === "BLOCKED") throw new BusinessError("USER_BLOCKED");
    if (relation?.status !== "ACCEPTED") throw new BusinessError("FRIENDSHIP_REQUIRED");
  }
}
