# POLYMARKET ARBITRAGE BOT - DEPLOYMENT GUIDE

## ⚡ Quick Start

El bot está 100% listo. Solo necesitas:

1. **API credentials de Polymarket**
2. **Telegram Bot Token**
3. **DigitalOcean Droplet** ($5/mes)

---

## PASO 1: Obtener Polymarket API Credentials

### 1.1 Dentro de tu cuenta Polymarket:

1. Ve a **Settings → API Keys** (o similar, depende del UI actual)
2. Genera una nueva API key
3. Te dará:
   - `API_KEY` (algo como `0x...`)
   - `API_SECRET` (hash largo)
   - `API_PASSPHRASE` (passphrase)

**Guarda estos valores en un lugar seguro.**

---

## PASO 2: Crear Telegram Bot

### 2.1 En Telegram:

1. Abre Telegram
2. Busca `@BotFather`
3. Envía `/newbot`
4. Sigue los pasos:
   - Nombre: `PolymarketArbitrageBot`
   - Username: `polymarket_arb_bot_tuusername`
5. **Copiar el Token** que BotFather te da (algo como `123456:ABCDef...`)

### 2.2 Obtener tu Chat ID (ya lo tienes: `1638167664`)

Ya lo tienes: `1638167664`

---

## PASO 3: Crear DigitalOcean Droplet

### 3.1 Crear servidor:

1. Ve a [digitalocean.com](https://digitalocean.com)
2. **Create → Droplets**
3. Configuración:
   - **OS**: Ubuntu 22.04 x64
   - **Plan**: Basic ($5/month, 512MB RAM, 1 vCPU)
   - **Region**: New York (u otro cercano)
   - **Auth**: SSH Key (más seguro) o Password
4. **Create Droplet**

### 3.2 Conectar al Droplet:

```bash
ssh root@<TU_IP_DROPLET>
```

(Si usaste password, te pedirá que la ingreses)

---

## PASO 4: Instalar Node.js

```bash
# Actualizar paquetes
apt update && apt upgrade -y

# Instalar Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Verificar
node --version
npm --version
```

---

## PASO 5: Deploy del Bot

### 5.1 Clonar/crear el directorio:

```bash
mkdir -p /opt/polymarket-bot
cd /opt/polymarket-bot
```

### 5.2 Crear los archivos:

**Crear `polymarket-bot.js`:**
```bash
cat > polymarket-bot.js << 'EOF'
[PEGA TODO EL CONTENIDO DE polymarket-bot.js AQUÍ]
EOF
```

**Crear `package.json`:**
```bash
cat > package.json << 'EOF'
[PEGA TODO EL CONTENIDO DE package.json AQUÍ]
EOF
```

### 5.3 Instalar dependencias:

```bash
npm install
```

---

## PASO 6: Configurar Variables de Entorno

### 6.1 Crear `.env`:

```bash
cat > .env << 'EOF'
POLYMARKET_API_KEY=<Tu API Key de Polymarket>
POLYMARKET_SECRET=<Tu API Secret de Polymarket>
POLYMARKET_PASSPHRASE=<Tu API Passphrase de Polymarket>
TELEGRAM_BOT_TOKEN=<Tu Telegram Bot Token de BotFather>
TELEGRAM_CHAT_ID=1638167664
EOF
```

### 6.2 Cargar variables:

```bash
export $(cat .env | xargs)
```

---

## PASO 7: Instalar PM2 (para correr 24/7)

PM2 asegura que el bot se reinicie automáticamente si falla.

```bash
npm install -g pm2

# Iniciar bot con PM2
pm2 start polymarket-bot.js --name "polymarket-bot"

# Logs en tiempo real
pm2 logs polymarket-bot

# Ver estado
pm2 status

# Iniciar al boot
pm2 startup
pm2 save
```

---

## PASO 8: Verificar que funciona

### 8.1 Chequear logs:

```bash
pm2 logs polymarket-bot
```

Deberías ver:
```
🤖 Starting Polymarket Arbitrage Bot
Config: { tradeSize: 1, minSpread: '1.5%', ... }
```

### 8.2 Chequear Telegram:

Si todo está bien, recibirás un mensaje en Telegram:
```
🚀 Bot iniciado

Config:
• Trade size: $1
• Min spread: 1.5%
• Max drawdown: -$40
```

---

## PASO 9: Depositar USDC en Polymarket

Una vez que el bot esté corriendo y verificado:

1. Envía 100 USDC desde Binance a tu wallet de Polymarket
2. Deposita esos 100 USDC a tu cuenta Polymarket
3. **El bot empezará a buscar arbitrajes automáticamente**

---

## 🔧 TROUBLESHOOTING

### Bot no inicia:
```bash
pm2 logs polymarket-bot --err
```

### Variables de entorno no se cargan:
```bash
# Edita el archivo .env
nano .env

# Y reinicia PM2
pm2 restart polymarket-bot
```

### Telegram no recibe mensajes:
- Verifica que `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` sean correctos
- Abre tu bot en Telegram: `t.me/<tu_username_del_bot>`

### Polymarket API retorna errores:
- Verifica credenciales en `.env`
- Asegúrate de que el wallet tiene saldo

---

## 📊 MONITOREO

### Ver estado del bot en tiempo real:

```bash
pm2 monit
```

### Ver logs completos:

```bash
pm2 logs polymarket-bot
```

### Reiniciar bot:

```bash
pm2 restart polymarket-bot
```

### Detener bot:

```bash
pm2 stop polymarket-bot
```

---

## ⚠️ NOTAS IMPORTANTES

1. **Seguridad**: El `.env` contiene tus credenciales. NO lo subas a GitHub.
2. **Comisiones**: Polymarket tiene comisiones por trade. El bot ya las considera en el cálculo.
3. **Spread mínimo**: Actualmente seteado a 1.5%. Ajusta según lo que observes en el mercado.
4. **Max drawdown**: Si PnL cae a -$40, el bot se pausa automáticamente.
5. **Testing**: Los primeros días observa los logs. Ajusta parámetros según sea necesario.

---

## 📞 SOPORTE

Si algo no funciona:

1. Chequea los logs: `pm2 logs polymarket-bot`
2. Verifica que Telegram recibe mensajes del bot
3. Confirma que tienes saldo en Polymarket
4. Revisa que las credenciales de API sean correctas

---

**¡El bot está listo! Una vez tengas las credenciales, es un simple copy-paste.**
