import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../../../../src/configs/database.js";
import { FriendPgRepository } from "../../../../src/domain/friend/pg.js";

const userId = "0193a2b1-0000-7000-8000-000000000001";
const friendId = "0193a2b1-0000-7000-8000-000000000002";
const otherFriendId = "0193a2b1-0000-7000-8000-000000000003";

describe("FriendPgRepository.getAcceptedFriendIds", () => {
  it("returns all accepted friends in either pair ordering", async () => {
    const where = vi.fn().mockResolvedValue([
      { userLow: userId, userHigh: friendId },
      { userLow: otherFriendId, userHigh: userId },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repo = new FriendPgRepository({ select } as unknown as DrizzleDb);

    await expect(repo.getAcceptedFriendIds(userId)).resolves.toEqual([friendId, otherFriendId]);

    const condition = where.mock.calls[0][0] as SQL;
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"friendships"."status" =');
    expect(query.sql).toContain('"friendships"."user_low" =');
    expect(query.sql).toContain('"friendships"."user_high" =');
    expect(query.params).toEqual(["ACCEPTED", userId, userId]);
  });
});
