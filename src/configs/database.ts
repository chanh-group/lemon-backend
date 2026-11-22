import { Global, Module } from "@nestjs/common";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { get_env } from "../helpers/index.js";
import * as schema from "./schema.js";

export type DrizzleDb = NodePgDatabase<typeof schema>;

export const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/lemon_chat";

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      useFactory: () => ({
        drizzle,
        connection: {
          connectionString: get_env("DATABASE_URL", DEFAULT_DATABASE_URL),
        },
        schema,
        logger: false,
        autoCloseConnection: true,
      }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DatabaseModule {}
