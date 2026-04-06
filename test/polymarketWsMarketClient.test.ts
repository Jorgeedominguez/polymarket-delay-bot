import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Logger } from "pino";
import { PolymarketWsMarketClient } from "../src/clients/polymarketWsMarketClient";

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createOpenSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe("PolymarketWsMarketClient", () => {
  it("sends the expected initial market subscription payload with sanitized asset ids", () => {
    const logger = createLogger();
    const socket = createOpenSocket();
    const client = new PolymarketWsMarketClient(logger);

    (client as any).socket = socket;
    (client as any).connected = true;

    client.subscribeAssets(["123", "", "123", "456"]);

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      assets_ids: ["123", "456"],
      type: "market",
      custom_feature_enabled: true,
    });
  });

  it("uses operation=subscribe for incremental market subscriptions after the initial payload", () => {
    const logger = createLogger();
    const socket = createOpenSocket();
    const client = new PolymarketWsMarketClient(logger);

    (client as any).socket = socket;
    (client as any).connected = true;

    client.subscribeAssets(["123", "456"]);
    client.subscribeAssets(["456", "789"]);

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({
      assets_ids: ["789"],
      operation: "subscribe",
      custom_feature_enabled: true,
    });
  });

  it("does not crash on non-json payloads and logs the raw payload", () => {
    const logger = createLogger();
    const socket = createOpenSocket();
    const client = new PolymarketWsMarketClient(logger);

    (client as any).socket = socket;

    expect(() => (client as any).handleRawMessage(Buffer.from("INVALID OPERATION"))).not.toThrow();
    expect((logger.warn as any).mock.calls[0][0]).toMatchObject({
      rawPayload: "INVALID OPERATION",
    });
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
