# Binance -> Polymarket Delay Bot

Bot modular en TypeScript para detectar movimientos rápidos de `BTCUSDT` en Binance y explotar el retraso de ajuste en mercados BTC `5m` y `15m` de Polymarket.

La implementación vieja fue archivada en [`legacy/README.md`](/C:/Users/jorge/Desktop/Trading/Polymarket%20bot/legacy/README.md). La entrada principal ahora es [`src/app/main.ts`](/C:/Users/jorge/Desktop/Trading/Polymarket%20bot/src/app/main.ts).

## Qué hace esta versión

- Usa WebSocket oficial de Binance para `BTCUSDT@trade`
- Usa discovery dinámico de mercados BTC 5m/15m en Polymarket
- Usa WebSocket oficial de Polymarket para market data
- Usa WebSocket oficial de Polymarket para usuario cuando hay credenciales L2 reales
- Usa `@polymarket/clob-client` para auth y órdenes live
- Usa SQLite para persistencia de señales, órdenes, fills, posiciones y eventos
- Expone control por Telegram y endpoints HTTP locales
- Arranca en `SHADOW_MODE=true` y `LIVE_TRADING=false`

## Arquitectura

```text
src/
  config/
  clients/
  discovery/
  signal/
  strategy/
  execution/
  risk/
  persistence/
  app/
  utils/
test/
legacy/
```

## Requisitos

- Node.js 20+
- Credenciales Telegram para control remoto
- Para live mode real:
  - `POLYMARKET_PRIVATE_KEY`
  - `POLYMARKET_API_KEY`
  - `POLYMARKET_API_SECRET`
  - `POLYMARKET_API_PASSPHRASE`
  - opcionalmente `POLYMARKET_FUNDER_ADDRESS`

## Instalación

1. Instala Node.js 20 o superior.
2. Copia [` .env.example`](/C:/Users/jorge/Desktop/Trading/Polymarket%20bot/.env.example) a `.env`.
3. Completa las variables de entorno.
4. Instala dependencias:

```bash
npm install
```

5. Valida tipos y tests:

```bash
npm run typecheck
npm test
```

6. Arranca en local:

```bash
npm run dev
```

## Variables de entorno

Variables principales:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SHADOW_MODE`
- `LIVE_TRADING`
- `SYMBOL`
- `EDGE_THRESHOLD_BPS`
- `SLIPPAGE_BUFFER_BPS`
- `BINANCE_MOVE_WINDOW_MS`
- `BINANCE_MIN_MOVE_BPS`
- `STALE_BOOK_MS`
- `MAX_NOTIONAL_PER_TRADE`
- `MAX_TOTAL_EXPOSURE`
- `MAX_DRAWDOWN_DAILY`
- `ENTRY_TIMEOUT_MS`
- `EXIT_TIMEOUT_MS`
- `TELEGRAM_NOTIFY_ALL`

Variables adicionales útiles:

- `POLY_5M_SENSITIVITY`
- `POLY_15M_SENSITIVITY`
- `TAKE_PROFIT_BPS`
- `STOP_LOSS_BPS`
- `MAX_SIMULTANEOUS_ORDERS`
- `MAX_OPEN_POSITIONS_PER_MARKET`
- `DISCOVERY_REFRESH_MS`
- `HEARTBEAT_INTERVAL_MS`
- `HTTP_HOST`
- `HTTP_PORT`

## Cómo corre el bot

1. Descubre mercados BTC 5m/15m desde Gamma y los enriquece con metadata del CLOB.
2. Se suscribe por WS a los token IDs `YES` y `NO`.
3. Escucha `BTCUSDT` en Binance por WebSocket.
4. Detecta dirección, magnitud y velocidad del movimiento.
5. Convierte el movimiento en una expectativa de probabilidad para Polymarket.
6. Evalúa edge neto usando book, fees, slippage, tick size, min order size y profundidad.
7. Si el riesgo lo permite:
   - en shadow mode simula fill contra el book
   - en live mode envía órdenes reales vía SDK oficial
8. Gestiona salidas por take profit, stop loss, timeout o invalidación del edge.

## Control por Telegram

Comandos implementados:

- `/startbot`
- `/pausebot`
- `/resumebot`
- `/killbot`
- `/status`
- `/positions`
- `/pnl`
- `/markets`
- `/config`
- `/summary`
- `/analysis`

Notificaciones implementadas:

- bot iniciado
- bot pausado
- bot reanudado
- kill switch activado
- mercado descubierto
- señal detectada
- señal descartada
- orden enviada
- orden rechazada
- fill parcial
- fill completo
- heartbeat periódico
- error de conexión
- reconexión exitosa

## Endpoints HTTP locales

- `GET /health`
- `GET /status`
- `GET /positions`
- `GET /signals/recent`
- `GET /markets`
- `GET /metrics/signals`
- `GET /metrics/summary`
- `GET /metrics/analysis`
- `GET /metrics/buckets`
- `POST /pause`
- `POST /resume`
- `POST /kill`

## Shadow mode

Modo por defecto:

- `SHADOW_MODE=true`
- `LIVE_TRADING=false`

Comportamiento:

- no manda órdenes reales a Polymarket
- simula fills usando el lado agresor del book
- aplica fee taker y limita por profundidad disponible
- persiste órdenes, fills y posiciones en SQLite igual que live

## Live mode

Para activar:

```env
SHADOW_MODE=false
LIVE_TRADING=true
POLYMARKET_PRIVATE_KEY=...
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...
```

Advertencias:

- Esta base ya usa el SDK oficial `@polymarket/clob-client` para órdenes live.
- La conexión de usuario WS también está preparada.
- No fue validada aquí con credenciales reales porque este entorno no tiene tus secretos.
- Antes de usar dinero real, confirma el payload exacto de fills y órdenes del user WS con tu cuenta.

## Auth Polymarket: qué usa L1 y qué usa L2

L1:

- `POLYMARKET_PRIVATE_KEY`
- se usa para derivar o crear credenciales API si hace falta
- también es la base para construir el cliente autenticado

L2:

- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- se usan para envío/cancelación de órdenes y user websocket

Público:

- discovery por Gamma
- market metadata pública por CLOB
- market websocket público

## Docker

Build:

```bash
docker build -t binance-polymarket-delay-bot .
```

Run:

```bash
docker run --rm -p 3000:3000 --env-file .env binance-polymarket-delay-bot
```

## Smoke test local

Smoke test minimo sin credenciales live:

```bash
npm run smoke:shadow
```

Que valida:

- inicializacion SQLite
- runtime principal
- discovery mockeado
- signal engine
- ejecucion shadow
- persistencia de senal y posicion

Salida esperada:

- JSON con `"smoke": "ok"`
- al menos una senal persistida
- al menos una posicion shadow abierta

## Sesion de observacion de 2 a 4 horas

1. Arranca el bot en shadow mode:

```bash
npm run dev
```

2. Verifica que discovery, Binance WS y Polymarket WS queden arriba:

```bash
curl http://localhost:3000/status
```

3. Deja correr la sesion de observacion durante 2 a 4 horas sin credenciales live.

4. Consulta las senales instrumentadas:

```bash
curl http://localhost:3000/metrics/signals
```

5. Consulta el resumen agregado:

```bash
curl http://localhost:3000/metrics/summary
```

6. Consulta el analisis automatico:

```bash
curl http://localhost:3000/metrics/analysis
curl http://localhost:3000/metrics/buckets
```

7. Si usas Telegram, pide un resumen corto:

```text
/summary
/analysis
```

## Como leer resultados

Puntos clave para evaluar edge real:

- `estimatedDelayMs`: si el retraso medio es bajo o cero, probablemente no hay ventana explotable.
- `avgGrossEdgeBps` y `avgNetEdgeBps`: si el neto no sobrevive spread y slippage, la idea no tiene edge operativo.
- `signalsExecuted` vs `signalsDiscarded`: si casi todo termina descartado, el filtro es demasiado estricto o el edge no aparece.
- `distributionByMarket`: permite comparar si BTC 5m o BTC 15m concentra mejores oportunidades.
- `distributionBySkipReason`: muestra por que el setup no entra, por ejemplo `stale_book`, `risk_rejected` o `signal_threshold_or_score`.
- `simulatedWins` y `simulatedLosses`: ayudan a ver si la ejecucion shadow genera resultado positivo una vez que hay cierres simulados.
- `signalsPerHour`, `enteredRate` y `skipRate`: ayudan a saber si el sistema encuentra edge con suficiente frecuencia operable.
- `medianNetEdgeBps` y `medianDelayMs`: reducen el sesgo de outliers.
- `expectancyPerSignal` y `expectancyPerExecutedTrade`: muestran si el edge agregado compensa la friccion operativa.
- `metrics/buckets`: ayuda a identificar si el edge aparece solo en ciertos tamanos de movimiento, retraso o net edge.

## Reglas de interpretacion automatica

El sistema clasifica el estado observado como:

- `insuficiente data`
  - menos de 2 horas observadas, o
  - menos de 20 senales
- `edge prometedor`
  - datos suficientes, y
  - `avgNetEdgeBps >= 10`, y
  - `enteredRate >= 10%`, y
  - `expectancyPerExecutedTrade > 0`, y
  - `simulatedWinRate >= 50%` o todavia hay menos de 5 trades cerrados
- `edge debil`
  - hay datos suficientes, pero no cumple las condiciones anteriores

Estas reglas estan implementadas en el analisis del repositorio y sirven como semaforo inicial, no como garantia estadistica final.

## Interpretacion por horizonte temporal

Despues de 2 horas:

- busca al menos 20 senales
- observa si hay retraso medible y si `avgNetEdgeBps` sigue positivo
- si sigue en `insuficiente data`, todavia no saques conclusiones fuertes

Despues de 4 horas:

- compara `BTC 5m` vs `BTC 15m`
- mira medianas por mercado y top skip reasons
- revisa buckets para ver si el edge se concentra en movimientos o delays concretos

Despues de 1 dia completo:

- prioriza `expectancyPerExecutedTrade`, `signalsPerHour`, `enteredRate` y win/loss rate
- si el sistema sigue en `edge debil`, probablemente el edge no sea robusto
- si marca `edge prometedor` con frecuencia suficiente y expectancy positiva, ya tienes una base mejor para considerar validacion pre-live

## Persistencia SQLite

Tablas incluidas:

- `discovered_markets`
- `market_metadata`
- `binance_ticks`
- `polymarket_book_snapshots`
- `signals`
- `orders`
- `fills`
- `positions`
- `pnl_timeseries`
- `bot_events`
- `config_snapshots`

## Riesgo y seguridad implementados

- no opera si Binance WS está abajo
- no opera si Polymarket market WS está abajo
- no opera con book stale
- valida tick size y min order size
- limita notional por trade
- limita exposición total
- limita órdenes simultáneas
- limita posiciones abiertas por mercado
- kill switch manual
- kill switch por drawdown diario realizado
- cancelación masiva de órdenes al activar kill

## Troubleshooting

`npm` o `node` no existen:

- instala Node.js 20+
- verifica `node -v` y `npm -v`

No llegan mensajes de Telegram:

- valida `TELEGRAM_BOT_TOKEN`
- valida `TELEGRAM_CHAT_ID`
- asegúrate de haber iniciado conversación con el bot

No aparecen mercados BTC:

- revisa conectividad con `https://gamma-api.polymarket.com`
- verifica que existan mercados activos BTC 5m/15m en ese momento

Live mode falla al enviar órdenes:

- revisa `POLYMARKET_PRIVATE_KEY`
- revisa credenciales L2
- confirma `POLYMARKET_SIGNATURE_TYPE`
- confirma `POLYMARKET_FUNDER_ADDRESS` si tu cuenta lo requiere

## TODOs explícitos y honestos

- Validar en entorno real el payload exacto del user websocket para endurecer el parser de fills y estados.
- Confirmar con credenciales reales si la política final de entrada live debe ser `FAK` o market order segura según tu operativa.
- Añadir reconciliación de órdenes live al reiniciar el proceso usando snapshots del CLOB con tu cuenta real.

## Advertencia de riesgo

Este proyecto automatiza trading. Puede perder dinero, fallar por cambios de API o ejecutar en condiciones de mercado adversas. No uses fondos reales sin validar primero en shadow mode y luego con tamaño mínimo.
