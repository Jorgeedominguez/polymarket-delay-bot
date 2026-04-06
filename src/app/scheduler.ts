import { Logger } from "pino";
import { AppConfig } from "../config/env";
import { BotRuntime } from "./botRuntime";

export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly runtime: BotRuntime,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timers.push(
      setInterval(() => {
        this.runtime.refreshDiscovery().catch((error) => {
          this.logger.error({ component: "scheduler", err: error }, "Discovery refresh failed");
        });
      }, this.config.discovery.refreshMs),
    );

    this.timers.push(
      setInterval(() => {
        this.runtime.evaluateExits().catch((error) => {
          this.logger.error({ component: "scheduler", err: error }, "Exit evaluation failed");
        });
      }, this.config.exits.checkIntervalMs),
    );

    this.timers.push(
      setInterval(() => {
        this.runtime.sendHeartbeat().catch((error) => {
          this.logger.error({ component: "scheduler", err: error }, "Heartbeat failed");
        });
      }, this.config.heartbeat.intervalMs),
    );
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  }
}
