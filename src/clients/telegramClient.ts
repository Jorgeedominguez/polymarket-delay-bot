import { Telegraf } from "telegraf";
import { Logger } from "pino";

type CommandHandler = (chatId: string) => Promise<string> | string;

export class TelegramClient {
  private readonly bot?: Telegraf;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly logger: Logger,
  ) {
    if (botToken) {
      this.bot = new Telegraf(botToken);
    }
  }

  isEnabled(): boolean {
    return Boolean(this.bot);
  }

  registerCommand(command: string, handler: CommandHandler): void {
    if (!this.bot) {
      return;
    }

    this.bot.command(command.replace(/^\//, ""), async (ctx) => {
      const incomingChatId = String(ctx.chat.id);

      if (this.chatId && incomingChatId !== this.chatId) {
        this.logger.warn({ component: "telegram", incomingChatId }, "Ignoring Telegram command from unauthorized chat");
        return;
      }

      const response = await handler(incomingChatId);
      await ctx.reply(response);
    });
  }

  async start(): Promise<void> {
    if (!this.bot) {
      this.logger.warn({ component: "telegram" }, "Telegram disabled because TELEGRAM_BOT_TOKEN is missing");
      return;
    }

    await this.bot.launch();
    this.logger.info({ component: "telegram" }, "Telegram bot polling started");
  }

  async stop(): Promise<void> {
    if (!this.bot) {
      return;
    }

    await this.bot.stop();
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      return;
    }

    try {
      await this.bot.telegram.sendMessage(this.chatId, message);
    } catch (error) {
      this.logger.error({ component: "telegram", err: error }, "Failed to send Telegram message");
    }
  }
}
