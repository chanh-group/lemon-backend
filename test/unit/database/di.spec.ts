import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExamplePgRepository } from "../../../src/domain/example/pg.js";
import { UserPgRepository } from "../../../src/domain/user/pg.js";
import { DatabaseModule } from "../../../src/configs/database.js";

describe("NestJS Dependency Injection & Drizzle Module Verification", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [UserPgRepository, ExamplePgRepository],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("should compile DatabaseModule and register Drizzle client in DI container", () => {
    expect(moduleRef).toBeDefined();
  });

  it("should successfully resolve UserPgRepository with injected DrizzleDb", () => {
    const userRepo = moduleRef.get(UserPgRepository);
    expect(userRepo).toBeDefined();
    expect(typeof userRepo.findById).toBe("function");
    expect(typeof userRepo.findByEmail).toBe("function");
    expect(typeof userRepo.findByUsername).toBe("function");
  });

  it("should successfully resolve ExamplePgRepository with injected DrizzleDb", () => {
    const exampleRepo = moduleRef.get(ExamplePgRepository);
    expect(exampleRepo).toBeDefined();
    expect(typeof exampleRepo.findAll).toBe("function");
    expect(typeof exampleRepo.findById).toBe("function");
  });
});
