import { TelegramClient } from "../clients/telegramClient";
import { BotRuntime } from "./botRuntime";

export class CommandHandler {
  constructor(
    private readonly telegram: TelegramClient,
    private readonly runtime: BotRuntime,
  ) {}

  register(): void {
    this.telegram.registerCommand("/startbot", async () => this.runtime.startBot());
    this.telegram.registerCommand("/pausebot", async () => this.runtime.pauseBot("telegram"));
    this.telegram.registerCommand("/resumebot", async () => this.runtime.resumeBot());
    this.telegram.registerCommand("/killbot", async () => this.runtime.killBot("telegram"));
    this.telegram.registerCommand("/status", async () => this.runtime.formatStatus());
    this.telegram.registerCommand("/positions", async () => this.runtime.formatPositions());
    this.telegram.registerCommand("/pnl", async () => this.runtime.formatPnl());
    this.telegram.registerCommand("/markets", async () => this.runtime.formatMarkets());
    this.telegram.registerCommand("/config", async () => this.runtime.formatConfig());
    this.telegram.registerCommand("/summary", async () => this.runtime.formatSummary());
    this.telegram.registerCommand("/analysis", async () => this.runtime.formatAnalysis());
  }
}
