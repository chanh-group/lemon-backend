import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { REDIS_CLIENT } from "../utils/cache/store.js";
import type { RedisWithCacheCommands } from "../utils/cache/redis.js";

const REDIS_PROBE_INTERVAL_MS = 2_000;

@Injectable()
export class RedisHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthService.name);
  private ready: boolean;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private probing = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisWithCacheCommands) {
    this.ready = redis.status === "ready";
    redis.on("ready", () => this.setReady(true));
    redis.on("close", () => this.setReady(false));
    redis.on("end", () => this.setReady(false));
    redis.on("reconnecting", () => this.setReady(false));
    redis.on("error", (err: Error) => {
      this.setReady(false);
      this.logger.warn(`Redis health check failed: ${err.message}`);
    });
  }

  onModuleInit(): void {
    this.probeTimer = setInterval(() => void this.probe(), REDIS_PROBE_INTERVAL_MS);
    this.probeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  isReady(): boolean {
    return this.ready;
  }

  markUnavailable(reason: unknown): void {
    this.setReady(false);
    this.logger.error(`Redis operation failed; instance is unready: ${String(reason)}`);
  }

  private async probe(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      await this.redis.ping();
      this.setReady(true);
    } catch (err) {
      this.setReady(false);
      this.logger.warn(`Redis readiness probe failed: ${String(err)}`);
    } finally {
      this.probing = false;
    }
  }

  private setReady(ready: boolean): void {
    this.ready = ready;
  }
}
