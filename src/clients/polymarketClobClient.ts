import { ClobClient, OrderType, Side, TickSize } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { Logger } from "pino";
import { AppConfig } from "../config/env";
import { OrderIntent } from "../persistence/models";

export class PolymarketClobGateway {
  private readonly publicClient: ClobClient;
  private readonly l1Client?: ClobClient;
  private readonly l2Client?: ClobClient;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.publicClient = new ClobClient(config.polymarket.host, config.polymarket.chainId);

    if (config.polymarket.privateKey) {
      const signer = new Wallet(config.polymarket.privateKey);
      this.l1Client = new ClobClient(config.polymarket.host, config.polymarket.chainId, signer);

      if (
        config.polymarket.apiKey &&
        config.polymarket.apiSecret &&
        config.polymarket.apiPassphrase
      ) {
        const apiCreds = {
          apiKey: config.polymarket.apiKey,
          secret: config.polymarket.apiSecret,
          passphrase: config.polymarket.apiPassphrase,
        };

        this.l2Client = new ClobClient(
          config.polymarket.host,
          config.polymarket.chainId,
          signer,
          apiCreds as any,
          config.polymarket.signatureType,
          config.polymarket.funderAddress || undefined,
        );
      }
    }
  }

  getPublicClient(): ClobClient {
    return this.publicClient;
  }

  canUseL1(): boolean {
    return Boolean(this.l1Client);
  }

  canUseL2(): boolean {
    return Boolean(this.l2Client);
  }

  async createOrDeriveApiKey(): Promise<unknown> {
    if (!this.l1Client) {
      throw new Error("Polymarket L1 client is unavailable. Set POLYMARKET_PRIVATE_KEY.");
    }

    return this.l1Client.createOrDeriveApiKey();
  }

  async getMarket(conditionId: string): Promise<any> {
    return this.publicClient.getMarket(conditionId);
  }

  async getOrderBook(tokenId: string): Promise<any> {
    return this.publicClient.getOrderBook(tokenId);
  }

  async createAndPostLimitOrder(intent: OrderIntent): Promise<any> {
    if (!this.l2Client) {
      throw new Error("Polymarket L2 client is unavailable. Live trading requires private key and API credentials.");
    }

    // TODO: Confirm final live order policy (FAK vs market order) with real credentials before production rollout.
    this.logger.info(
      {
        component: "polymarketClob",
        conditionId: intent.conditionId,
        assetId: intent.assetId,
        outcome: intent.outcome,
        side: intent.side,
        mode: intent.mode,
      },
      "Submitting live Polymarket order",
    );

    return this.l2Client.createAndPostOrder(
      {
        tokenID: intent.assetId,
        price: intent.price,
        size: intent.size,
        side: intent.side === "BUY" ? Side.BUY : Side.SELL,
      },
      {
        tickSize: toSdkTickSize(intent.tickSize),
        negRisk: intent.negRisk,
      },
      OrderType.GTC,
    );
  }

  async cancelAllOrders(): Promise<any> {
    if (!this.l2Client) {
      throw new Error("Polymarket L2 client is unavailable. Live cancellation requires API credentials.");
    }

    return this.l2Client.cancelAll();
  }
}

function toSdkTickSize(tickSize: number): TickSize {
  if (tickSize <= 0.0001) {
    return "0.0001";
  }

  if (tickSize <= 0.001) {
    return "0.001";
  }

  if (tickSize <= 0.01) {
    return "0.01";
  }

  return "0.1";
}
