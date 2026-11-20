import { Injectable } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../../configs/database.js";
import { users } from "../user/schema.js";
import { toCursorPage, type CursorPage } from "../shared.js";
import { DEFAULT_CALL_PAGE_SIZE, MAX_CALL_PAGE_SIZE } from "./constants.js";
import type { CallRepository, CreateCallInput, UpdateCallStatusInput } from "./repository.js";
import { calls, type Call } from "./schema.js";
import type { CallWithUsers } from "./types.js";

const callerAlias = alias(users, "call_caller");
const calleeAlias = alias(users, "call_callee");

function mapRow(row: {
  call: Call;
  caller: { id: string; username: string; fullName: string; avatarUrl: string | null } | null;
  callee: { id: string; username: string; fullName: string; avatarUrl: string | null } | null;
}): CallWithUsers {
  return {
    ...row.call,
    ...(row.caller && { caller: row.caller }),
    ...(row.callee && { callee: row.callee }),
  };
}

@Injectable()
export class CallPgRepository implements CallRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}

  async createCall(input: CreateCallInput): Promise<CallWithUsers> {
    const [inserted] = await this.db
      .insert(calls)
      .values({
        conversationId: input.conversationId,
        callerId: input.callerId,
        calleeId: input.calleeId,
        media: input.media,
        status: "INITIATED",
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert call");
    }

    const callWithUsers = await this.findById(inserted.id);
    if (!callWithUsers) {
      return {
        ...inserted,
      };
    }
    return callWithUsers;
  }

  async findById(callId: string): Promise<CallWithUsers | null> {
    const [row] = await this.db
      .select({
        call: calls,
        caller: {
          id: callerAlias.id,
          username: callerAlias.username,
          fullName: callerAlias.fullName,
          avatarUrl: callerAlias.avatarUrl,
        },
        callee: {
          id: calleeAlias.id,
          username: calleeAlias.username,
          fullName: calleeAlias.fullName,
          avatarUrl: calleeAlias.avatarUrl,
        },
      })
      .from(calls)
      .leftJoin(callerAlias, eq(calls.callerId, callerAlias.id))
      .leftJoin(calleeAlias, eq(calls.calleeId, calleeAlias.id))
      .where(eq(calls.id, callId));

    return row ? mapRow(row) : null;
  }

  async findActiveCallForUser(userId: string): Promise<CallWithUsers | null> {
    const [row] = await this.db
      .select({
        call: calls,
        caller: {
          id: callerAlias.id,
          username: callerAlias.username,
          fullName: callerAlias.fullName,
          avatarUrl: callerAlias.avatarUrl,
        },
        callee: {
          id: calleeAlias.id,
          username: calleeAlias.username,
          fullName: calleeAlias.fullName,
          avatarUrl: calleeAlias.avatarUrl,
        },
      })
      .from(calls)
      .leftJoin(callerAlias, eq(calls.callerId, callerAlias.id))
      .leftJoin(calleeAlias, eq(calls.calleeId, calleeAlias.id))
      .where(
        and(
          or(eq(calls.callerId, userId), eq(calls.calleeId, userId)),
          inArray(calls.status, ["INITIATED", "RINGING", "ACCEPTED"]),
        ),
      )
      .orderBy(desc(calls.startedAt), desc(calls.id))
      .limit(1);

    return row ? mapRow(row) : null;
  }

  async updateStatus(
    callId: string,
    expectedStatuses: Array<Call["status"]>,
    updates: UpdateCallStatusInput,
  ): Promise<CallWithUsers | null> {
    const [updated] = await this.db
      .update(calls)
      .set({
        status: updates.status,
        ...(updates.answeredAt !== undefined && { answeredAt: updates.answeredAt }),
        ...(updates.endedAt !== undefined && { endedAt: updates.endedAt }),
        ...(updates.endReason !== undefined && { endReason: updates.endReason }),
      })
      .where(and(eq(calls.id, callId), inArray(calls.status, expectedStatuses)))
      .returning();

    if (!updated) {
      return null;
    }

    return this.findById(updated.id);
  }

  async findCallsByConversation(
    conversationId: string,
    limit = DEFAULT_CALL_PAGE_SIZE,
    cursor?: string,
  ): Promise<CursorPage<CallWithUsers>> {
    const queryLimit = Math.min(Math.max(limit, 1), MAX_CALL_PAGE_SIZE);
    const conditions = [eq(calls.conversationId, conversationId)];

    if (cursor) {
      const cursorStartedAt = sql`(SELECT c.started_at FROM calls c WHERE c.id = ${cursor})`;
      conditions.push(
        or(
          lt(calls.startedAt, cursorStartedAt),
          and(eq(calls.startedAt, cursorStartedAt), lt(calls.id, cursor)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        call: calls,
        caller: {
          id: callerAlias.id,
          username: callerAlias.username,
          fullName: callerAlias.fullName,
          avatarUrl: callerAlias.avatarUrl,
        },
        callee: {
          id: calleeAlias.id,
          username: calleeAlias.username,
          fullName: calleeAlias.fullName,
          avatarUrl: calleeAlias.avatarUrl,
        },
      })
      .from(calls)
      .leftJoin(callerAlias, eq(calls.callerId, callerAlias.id))
      .leftJoin(calleeAlias, eq(calls.calleeId, calleeAlias.id))
      .where(and(...conditions))
      .orderBy(desc(calls.startedAt), desc(calls.id))
      .limit(queryLimit + 1);

    const mapped = rows.map(mapRow);
    return toCursorPage(mapped, queryLimit, (item) => item.id);
  }

  async findCallsByUser(
    userId: string,
    limit = DEFAULT_CALL_PAGE_SIZE,
    cursor?: string,
  ): Promise<CursorPage<CallWithUsers>> {
    const queryLimit = Math.min(Math.max(limit, 1), MAX_CALL_PAGE_SIZE);
    const conditions = [or(eq(calls.callerId, userId), eq(calls.calleeId, userId))!];

    if (cursor) {
      const cursorStartedAt = sql`(SELECT c.started_at FROM calls c WHERE c.id = ${cursor})`;
      conditions.push(
        or(
          lt(calls.startedAt, cursorStartedAt),
          and(eq(calls.startedAt, cursorStartedAt), lt(calls.id, cursor)),
        )!,
      );
    }

    const rows = await this.db
      .select({
        call: calls,
        caller: {
          id: callerAlias.id,
          username: callerAlias.username,
          fullName: callerAlias.fullName,
          avatarUrl: callerAlias.avatarUrl,
        },
        callee: {
          id: calleeAlias.id,
          username: calleeAlias.username,
          fullName: calleeAlias.fullName,
          avatarUrl: calleeAlias.avatarUrl,
        },
      })
      .from(calls)
      .leftJoin(callerAlias, eq(calls.callerId, callerAlias.id))
      .leftJoin(calleeAlias, eq(calls.calleeId, calleeAlias.id))
      .where(and(...conditions))
      .orderBy(desc(calls.startedAt), desc(calls.id))
      .limit(queryLimit + 1);

    const mapped = rows.map(mapRow);
    return toCursorPage(mapped, queryLimit, (item) => item.id);
  }
}
