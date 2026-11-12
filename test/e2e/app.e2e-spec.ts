import { Test, TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "../../src/app.js";
import { REDIS_CLIENT } from "../../src/utils/cache/store.js";
import type { RedisWithCacheCommands } from "../../src/utils/cache/redis.js";

describe("Application readiness (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
    await moduleFixture.get<RedisWithCacheCommands>(REDIS_CLIENT).ping();
  });

  it("reports ready when Redis is connected", async () => {
    const res = await request(app.getHttpServer()).get("/api/health/ready").expect(200);
    expect(res.body).toEqual({ success: true, ready: true });
  });

  afterAll(async () => {
    await app.close();
  });
});
