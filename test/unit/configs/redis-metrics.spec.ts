import { describe, expect, it } from "vitest";
import { RedisMetricsService } from "../../../src/configs/redis-metrics.js";

describe("RedisMetricsService", () => {
  it("exposes low-cardinality operation, cache, and readiness metrics", async () => {
    const metrics = new RedisMetricsService();
    await metrics.measure("cache_get", async () => null);
    metrics.recordLookup("story_feed", "miss");
    metrics.setReady(false);

    const output = metrics.toPrometheusText();
    expect(output).toContain('operation="cache_get",outcome="success"} 1');
    expect(output).toContain('cache="story_feed",result="miss"} 1');
    expect(output).toContain("lemonchat_redis_ready 0");
    expect(output).not.toContain("userId");
  });

  it("counts failed operations and preserves the original error", async () => {
    const metrics = new RedisMetricsService();
    const failure = new Error("redis down");

    await expect(
      metrics.measure("unread_write", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(metrics.toPrometheusText()).toContain('operation="unread_write",outcome="error"} 1');
  });
});
