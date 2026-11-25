import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { messageVisibleToParticipant } from "../../../../src/domain/conversation/visibility.js";

const dialect = new PgDialect();

describe("messageVisibleToParticipant", () => {
  it("keeps all three visibility branches and the boundary subquery", () => {
    const rendered = dialect.sqlToQuery(messageVisibleToParticipant(sql`m.conversation_id = 'c1'`));

    expect(rendered.sql).toContain('"history_boundary_message_id" IS NOT NULL');
    expect(rendered.sql).toContain("ROW(");
    expect(rendered.sql).toContain('"history_boundary_was_empty" = true');
    expect(rendered.sql).toContain('"history_boundary_was_empty" = false');
    expect(rendered.sql).toContain('"joined_at"');
    expect(rendered.sql).toContain("m.conversation_id = 'c1'");
  });

  it("binds the conversation filter as a parameter", () => {
    const rendered = dialect.sqlToQuery(
      messageVisibleToParticipant(sql`m.conversation_id = ${"c1"}`),
    );

    expect(rendered.sql).toContain("m.conversation_id = $1");
    expect(rendered.params).toEqual(["c1"]);
  });
});
