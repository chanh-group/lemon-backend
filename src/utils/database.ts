import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const created = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).defaultNow().notNull();

export const updated = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const uuidV7 = (name: string) => uuid(name).$defaultFn(() => uuidv7());
