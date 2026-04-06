#!/usr/bin/env node

/**
 * POLYMARKET ARBITRAGE BOT
 * Monitorea spreads en BTC Up/Down 5-15min
 * Ejecuta arbitraje automáticamente
 * Notifica en Telegram
 * 
 * Environment variables requeridas:
 * - POLYMARKET_API_KEY
 * - POLYMARKET_SECRET
 * - POLYMARKET_PASSPHRASE
 * - TELEGRAM_BOT_TOKEN
 * - TELEGRAM_CHAT_ID
 */

const https = require('https');
const crypto = require('crypto');

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  // Polymarket API
  POLYMARKET_API_URL: 'https://clob.polymarket.com',
  API_KEY: process.env.POLYMARKET_API_KEY,
  API_SECRET: process.env.POLYMARKET_SECRET,
  API_PASSPHRASE: process.env.POLYMARKET_PASSPHRASE,

  // Trading parameters
  TRADE_SIZE_USD: 1, // $1 per trade
  MIN_SPREAD_PERCENT: 1.5, // Mínimo spread para ejecutar
  CHECK_INTERVAL_MS: 5000, // Revisar spreads cada 5 segundos
  MAX_DRAWDOWN_USD: -40, // Stop si PnL < -$40
  MAX_TRADES_PER_DAY: 100, // Límite de trades por día

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // Markets BTC (IDs dinámicos, buscamos por nombre)
  BTC_5MIN_MARKET_NAME: 'Bitcoin Up or Down - 5 Minutes',
  BTC_15MIN_MARKET_NAME: 'Bitcoin Up or Down - 15 Minutes',
};

// ============================================================================
// STATE
// ============================================================================

let botState = {
  isRunning: false,
  balance: 0,
  pnl: 0,
  tradesToday: 0,
  lastCheckTime: 0,
  markets: {}, // Cached markets
  positions: {}, // Cached positions
  isPaused: false,
  pauseReason: null,
};

// ============================================================================
// UTILS: HTTP REQUESTS
// ============================================================================

function makeHttpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// ============================================================================
// POLYMARKET API: AUTHENTICATION
// ============================================================================

function signRequest(method, endpoint, body = null, timestamp = null) {
  if (!timestamp) {
    timestamp = Math.floor(Date.now() / 1000).toString();
  }

  const messageToSign = timestamp + method + endpoint + (body ? JSON.stringify(body) : '');
  const signature = crypto
    .createHmac('sha256', CONFIG.API_SECRET)
    .update(messageToSign)
    .digest('base64');

  return {
    timestamp,
    signature,
  };
}

// ============================================================================
// POLYMARKET API: CALLS
// ============================================================================

async function polymarketRequest(method, endpoint, body = null) {
  const { timestamp, signature } = signRequest(method, endpoint, body);

  const options = {
    hostname: 'clob.polymarket.com',
    path: endpoint,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'POLY-ADDRESS': CONFIG.API_KEY,
      'POLY-SIGNATURE': signature,
      'POLY-TIMESTAMP': timestamp,
      'POLY-NONCE': Math.random().toString(),
    },
  };

  try {
    const response = await makeHttpRequest(options, body);
    if (response.status >= 400) {
      console.error(`API Error (${response.status}):`, response.data);
      return null;
    }
    return response.data;
  } catch (error) {
    console.error('Request error:', error.message);
    return null;
  }
}

async function getMarkets() {
  const markets = await polymarketRequest('GET', '/markets');
  if (markets && Array.isArray(markets)) {
    // Cache markets
    markets.forEach((market) => {
      botState.markets[market.id] = market;
    });
  }
  return markets;
}

async function getOrders() {
  return await polymarketRequest('GET', '/orders');
}

async function getPositions() {
  return await polymarketRequest('GET', '/positions');
}

async function getBalance() {
  const user = await polymarketRequest('GET', '/user');
  if (user && user.balance_usdc) {
    botState.balance = parseFloat(user.balance_usdc);
  }
  return botState.balance;
}

async function createOrder(marketId, outcome, side, price, size) {
  const body = {
    token_id: marketId,
    side: side, // 'BUY' or 'SELL'
    outcome: outcome, // 'YES' or 'NO'
    price: price.toString(),
    size: size.toString(),
  };

  return await polymarketRequest('POST', '/orders', body);
}

// ============================================================================
// TELEGRAM
// ============================================================================

async function sendTelegramMessage(message) {
  const botToken = CONFIG.TELEGRAM_BOT_TOKEN;
  const chatId = CONFIG.TELEGRAM_CHAT_ID;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const body = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  };

  try {
    await makeHttpRequest(options, body);
  } catch (error) {
    console.error('Telegram error:', error.message);
  }
}

// ============================================================================
// ARBITRAGE DETECTION & EXECUTION
// ============================================================================

async function detectAndExecuteArbitrage() {
  if (botState.isPaused) {
    return;
  }

  try {
    // Obtener mercados
    const markets = await getMarkets();
    if (!markets) {
      console.log('No markets data');
      return;
    }

    // Buscar mercados BTC 5min y 15min
    const btc5min = markets.find(
      (m) => m.question && m.question.includes('Bitcoin') && m.question.includes('5 Minutes')
    );
    const btc15min = markets.find(
      (m) => m.question && m.question.includes('Bitcoin') && m.question.includes('15 Minutes')
    );

    if (!btc5min || !btc15min) {
      console.log('BTC markets not found');
      return;
    }

    console.log(`[${new Date().toISOString()}] Checking BTC 5min: ${btc5min.id}`);
    console.log(`[${new Date().toISOString()}] Checking BTC 15min: ${btc15min.id}`);

    // Obtener order books / precios (simulado - en producción usar mejor API)
    // Para este MVP, asumimos que los precios vienen del mercado
    const spread5min = calculateSpread(btc5min);
    const spread15min = calculateSpread(btc15min);

    // Buscar arbitraje (YES_PRICE_5MIN + NO_PRICE_5MIN < 1.0)
    if (spread5min && spread5min.arbitrageOpportunity) {
      console.log(`ARBITRAJE DETECTADO EN 5MIN: ${spread5min.margin.toFixed(4)} (${(spread5min.margin * 100).toFixed(2)}%)`);

      await executeTrade(btc5min, spread5min);
    }

    if (spread15min && spread15min.arbitrageOpportunity) {
      console.log(`ARBITRAJE DETECTADO EN 15MIN: ${spread15min.margin.toFixed(4)} (${(spread15min.margin * 100).toFixed(2)}%)`);

      await executeTrade(btc15min, spread15min);
    }
  } catch (error) {
    console.error('Error detecting arbitrage:', error.message);
  }
}

function calculateSpread(market) {
  // Este es un placeholder - en producción necesitas el order book real
  // Polymarket proporciona YES/NO prices que puedes usar

  if (!market.outcomes || market.outcomes.length < 2) {
    return null;
  }

  const yesPrice = parseFloat(market.outcomes[0].price || 0);
  const noPrice = parseFloat(market.outcomes[1].price || 0);

  if (!yesPrice || !noPrice) {
    return null;
  }

  const sum = yesPrice + noPrice;
  const margin = 1.0 - sum; // Ganancia si ejecutas ambos lados

  return {
    yesPrice,
    noPrice,
    sum,
    margin,
    arbitrageOpportunity: margin > CONFIG.MIN_SPREAD_PERCENT / 100, // Convertir % a decimal
  };
}

async function executeTrade(market, spread) {
  if (botState.tradesToday >= CONFIG.MAX_TRADES_PER_DAY) {
    console.log('Max trades per day reached');
    return;
  }

  // Calcular tamaño basado en 1% de riesgo, pero limitado a $1
  const tradeSize = CONFIG.TRADE_SIZE_USD;

  console.log(`Executing arbitrage: BUY YES @ ${spread.yesPrice}, SELL NO @ ${spread.noPrice}`);

  try {
    // Orden 1: BUY YES
    const order1 = await createOrder(market.id, 'YES', 'BUY', spread.yesPrice, tradeSize);
    console.log('Order 1 (BUY YES):', order1);

    // Orden 2: SELL NO
    const order2 = await createOrder(market.id, 'NO', 'SELL', spread.noPrice, tradeSize);
    console.log('Order 2 (SELL NO):', order2);

    if (order1 && order2) {
      botState.tradesToday++;

      const expectedProfit = tradeSize * spread.margin;
      const message = `✅ ARBITRAGE EXECUTED\n\nMarket: ${market.question}\nSize: $${tradeSize}\nSpread: ${(spread.margin * 100).toFixed(2)}%\nExpected Profit: $${expectedProfit.toFixed(2)}`;

      console.log(message);
      await sendTelegramMessage(message);
    }
  } catch (error) {
    console.error('Trade execution error:', error.message);
    await sendTelegramMessage(`❌ ERROR executing trade: ${error.message}`);
  }
}

// ============================================================================
// MONITORING
// ============================================================================

async function monitorBalance() {
  const balance = await getBalance();
  console.log(`[${new Date().toISOString()}] Balance: $${balance.toFixed(2)}`);

  // Calcular PnL (balance actual vs inicial)
  // Nota: necesitarías guardar balance inicial
  botState.pnl = balance - 100; // Asumiendo que empezaste con $100

  if (botState.pnl < CONFIG.MAX_DRAWDOWN_USD) {
    botState.isPaused = true;
    botState.pauseReason = 'Max drawdown reached';
    const message = `🛑 BOT PAUSED\n\nReason: Max drawdown ($${CONFIG.MAX_DRAWDOWN_USD}) reached\nCurrent PnL: $${botState.pnl.toFixed(2)}\nBalance: $${balance.toFixed(2)}`;
    console.log(message);
    await sendTelegramMessage(message);
  }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function startBot() {
  console.log('🤖 Starting Polymarket Arbitrage Bot');
  console.log(`Config:`, {
    tradeSize: CONFIG.TRADE_SIZE_USD,
    minSpread: CONFIG.MIN_SPREAD_PERCENT + '%',
    maxDrawdown: CONFIG.MAX_DRAWDOWN_USD,
    checkInterval: CONFIG.CHECK_INTERVAL_MS + 'ms',
  });

  botState.isRunning = true;

  // Notificar en Telegram
  await sendTelegramMessage(`🚀 Bot iniciado\n\nConfig:\n• Trade size: $${CONFIG.TRADE_SIZE_USD}\n• Min spread: ${CONFIG.MIN_SPREAD_PERCENT}%\n• Max drawdown: $${CONFIG.MAX_DRAWDOWN_USD}`);

  // Main loop
  setInterval(async () => {
    if (!botState.isRunning) return;

    botState.lastCheckTime = Date.now();

    // Revisar balance
    await monitorBalance();

    // Detectar y ejecutar arbitraje
    await detectAndExecuteArbitrage();
  }, CONFIG.CHECK_INTERVAL_MS);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Validar config
if (!CONFIG.API_KEY || !CONFIG.API_SECRET || !CONFIG.API_PASSPHRASE) {
  console.error('❌ Missing Polymarket API credentials');
  console.error('Set: POLYMARKET_API_KEY, POLYMARKET_SECRET, POLYMARKET_PASSPHRASE');
  process.exit(1);
}

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
  console.error('❌ Missing Telegram credentials');
  console.error('Set: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID');
  process.exit(1);
}

// Iniciar bot
startBot().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  botState.isRunning = false;
  await sendTelegramMessage('⏹️ Bot detenido');
  process.exit(0);
});
