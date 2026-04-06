import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Logger } from "pino";

export class SqliteDb {
  readonly sqlite: Database.Database;

  constructor(dbPath: string, private readonly logger: Logger) {
    const fullPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    this.sqlite = new Database(fullPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");

    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS discovered_markets (
        condition_id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        question TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        active INTEGER NOT NULL,
        closed INTEGER NOT NULL,
        discovered_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS market_metadata (
        condition_id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        slug TEXT NOT NULL,
        question TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        yes_token_id TEXT NOT NULL,
        no_token_id TEXT NOT NULL,
        minimum_tick_size REAL NOT NULL,
        minimum_order_size REAL NOT NULL,
        taker_fee_bps REAL NOT NULL,
        maker_fee_bps REAL NOT NULL,
        active INTEGER NOT NULL,
        closed INTEGER NOT NULL,
        enable_order_book INTEGER NOT NULL,
        neg_risk INTEGER NOT NULL,
        last_discovered_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS binance_ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        trade_id TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        event_time INTEGER NOT NULL,
        trade_time INTEGER NOT NULL,
        market_maker INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS polymarket_book_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        best_bid REAL,
        best_ask REAL,
        midpoint REAL,
        bids_json TEXT NOT NULL,
        asks_json TEXT NOT NULL,
        min_order_size REAL NOT NULL,
        tick_size REAL NOT NULL,
        book_timestamp INTEGER NOT NULL,
        hash TEXT,
        received_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY,
        condition_id TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        side TEXT NOT NULL,
        reference_price REAL NOT NULL,
        target_price REAL NOT NULL,
        book_price REAL NOT NULL,
        expected_probability REAL NOT NULL,
        executable_size REAL NOT NULL,
        depth_available REAL NOT NULL,
        notional REAL NOT NULL,
        gross_edge_bps REAL NOT NULL,
        net_edge_bps REAL NOT NULL,
        score REAL NOT NULL,
        stale INTEGER NOT NULL,
        status TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        move_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signal_metrics (
        signal_id TEXT PRIMARY KEY,
        condition_id TEXT NOT NULL,
        market_label TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        binance_move_detected_at INTEGER NOT NULL,
        polymarket_detected_at INTEGER NOT NULL,
        estimated_delay_ms INTEGER NOT NULL,
        binance_move_bps REAL NOT NULL,
        gross_edge_bps REAL NOT NULL,
        net_edge_bps REAL NOT NULL,
        spread_observed REAL NOT NULL,
        spread_observed_bps REAL NOT NULL,
        slippage_estimated_bps REAL NOT NULL,
        depth_available REAL NOT NULL,
        decision TEXT NOT NULL,
        skip_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        signal_id TEXT,
        position_id TEXT,
        condition_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        side TEXT NOT NULL,
        mode TEXT NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        filled_size REAL NOT NULL,
        status TEXT NOT NULL,
        external_order_id TEXT,
        reject_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        position_id TEXT,
        condition_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        size REAL NOT NULL,
        fee REAL NOT NULL,
        mode TEXT NOT NULL,
        external_trade_id TEXT,
        filled_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        condition_id TEXT NOT NULL,
        market_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        status TEXT NOT NULL,
        entry_price REAL NOT NULL,
        current_price REAL,
        size REAL NOT NULL,
        entry_notional REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        opened_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        closed_at INTEGER,
        exit_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS pnl_timeseries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        realized_pnl REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        total_pnl REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_events (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config_snapshots (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    this.logger.info({ component: "db" }, "SQLite schema ready");
  }
}
