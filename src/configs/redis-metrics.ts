import { Injectable } from "@nestjs/common";

export type RedisMetricOperation =
  | "probe"
  | "cache_get"
  | "cache_set"
  | "cache_delete"
  | "cache_delete_many"
  | "cache_rotate_refresh"
  | "cache_create_session"
  | "cache_revoke_session"
  | "cache_check_otp"
  | "cache_lock"
  | "cache_unlock"
  | "rate_limit"
  | "unread_read"
  | "unread_write";

export type CacheMetricName = "story_feed" | "note_feed" | "unread";
type OperationOutcome = "success" | "error";
type LookupResult = "hit" | "miss";

@Injectable()
export class RedisMetricsService {
  private readonly operations = new Map<string, number>();
  private readonly durations = new Map<string, { totalMs: number; count: number }>();
  private readonly lookups = new Map<string, number>();
  private ready = 0;

  async measure<T>(operation: RedisMetricOperation, run: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const value = await run();
      this.recordOperation(operation, "success", performance.now() - startedAt);
      return value;
    } catch (err) {
      this.recordOperation(operation, "error", performance.now() - startedAt);
      throw err;
    }
  }

  recordOperation(
    operation: RedisMetricOperation,
    outcome: OperationOutcome,
    durationMs: number,
  ): void {
    const key = `${operation}|${outcome}`;
    this.operations.set(key, (this.operations.get(key) ?? 0) + 1);
    const duration = this.durations.get(operation) ?? { totalMs: 0, count: 0 };
    duration.totalMs += Math.max(0, durationMs);
    duration.count += 1;
    this.durations.set(operation, duration);
  }

  recordLookup(cache: CacheMetricName, result: LookupResult): void {
    const key = `${cache}|${result}`;
    this.lookups.set(key, (this.lookups.get(key) ?? 0) + 1);
  }

  setReady(ready: boolean): void {
    this.ready = ready ? 1 : 0;
  }

  toPrometheusText(): string {
    const lines = [
      "# HELP lemonchat_redis_operations_total Redis-backed operation count.",
      "# TYPE lemonchat_redis_operations_total counter",
    ];
    for (const [key, count] of [...this.operations].sort(([a], [b]) => a.localeCompare(b))) {
      const [operation, outcome] = key.split("|");
      lines.push(
        `lemonchat_redis_operations_total{operation="${operation}",outcome="${outcome}"} ${count}`,
      );
    }
    lines.push(
      "# HELP lemonchat_redis_operation_duration_ms Redis operation duration.",
      "# TYPE lemonchat_redis_operation_duration_ms summary",
    );
    for (const [operation, duration] of [...this.durations].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(
        `lemonchat_redis_operation_duration_ms_sum{operation="${operation}"} ${duration.totalMs.toFixed(3)}`,
        `lemonchat_redis_operation_duration_ms_count{operation="${operation}"} ${duration.count}`,
      );
    }
    lines.push(
      "# HELP lemonchat_cache_lookups_total Cache lookup results.",
      "# TYPE lemonchat_cache_lookups_total counter",
    );
    for (const [key, count] of [...this.lookups].sort(([a], [b]) => a.localeCompare(b))) {
      const [cache, result] = key.split("|");
      lines.push(`lemonchat_cache_lookups_total{cache="${cache}",result="${result}"} ${count}`);
    }
    lines.push(
      "# HELP lemonchat_redis_ready Whether Redis is currently healthy.",
      "# TYPE lemonchat_redis_ready gauge",
      `lemonchat_redis_ready ${this.ready}`,
      "",
    );
    return lines.join("\n");
  }
}
