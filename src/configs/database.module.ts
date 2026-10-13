import { Global, Logger, Module } from "@nestjs/common";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { get_env } from "../helpers/index.js";
import * as schema from "./schema.js";

export type DrizzleDb = NodePgDatabase<typeof schema>;

const sqlLogger = new Logger("SQL");
const isDev = get_env("NODE_ENV", "development") === "development";

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      useFactory: () => ({
        drizzle,
        connection: {
          connectionString: get_env(
            "DATABASE_URL",
            "postgres://postgres:postgres@localhost:5432/lemon_chat",
          ),
        },
        schema,
        logger: isDev
          ? {
              logQuery(query: string, params: unknown[]) {
                sqlLogger.debug({ query, params }, "SQL Execute");
              },
            }
          : false,
        autoCloseConnection: true,
      }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DatabaseModule {}
