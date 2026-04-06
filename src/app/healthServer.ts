import Fastify, { FastifyInstance } from "fastify";
import { AppConfig } from "../config/env";
import { BotRuntime } from "./botRuntime";

export class HealthServer {
  private readonly server: FastifyInstance;
  private readonly host: string;
  private readonly port: number;

  constructor(config: AppConfig, runtime: BotRuntime) {
    this.server = Fastify({ logger: false });
    this.host = config.http.host;
    this.port = config.http.port;

    this.server.get("/health", async () => ({
      ok: true,
      state: runtime.getStatus().state,
    }));

    this.server.get("/status", async () => runtime.getStatus());
    this.server.get("/positions", async () => runtime.getPositions());
    this.server.get("/signals/recent", async () => runtime.getRecentSignals());
    this.server.get("/markets", async () => runtime.getMarkets());
    this.server.get("/metrics/signals", async () => runtime.getSignalMetrics());
    this.server.get("/metrics/summary", async () => runtime.getSignalMetricsSummary());
    this.server.get("/metrics/analysis", async () => runtime.getSignalMetricsAnalysis());
    this.server.get("/metrics/buckets", async () => runtime.getSignalMetricsBuckets());

    this.server.post("/pause", async () => ({
      message: await runtime.pauseBot("http"),
    }));

    this.server.post("/resume", async () => ({
      message: await runtime.resumeBot(),
    }));

    this.server.post("/kill", async () => ({
      message: await runtime.killBot("http"),
    }));

  }

  async start(): Promise<void> {
    await this.server.listen({
      host: this.host,
      port: this.port,
    });
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
