import { Global, Module } from '@nestjs/common';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      useFactory: () => ({
        drizzle,
        connection: {
          connectionString:
            process.env['DATABASE_URL'] ??
            'postgres://postgres:postgres@localhost:5432/lemon_chat',
        },
        schema,
        autoCloseConnection: true,
      }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DatabaseModule {}

