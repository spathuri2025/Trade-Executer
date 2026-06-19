# TradeBuzz Bot Engine

A modular, production-ready automated trading bot engine built with Python FastAPI. Covers crypto, stocks, and forex markets. Safe by default — runs in paper trading mode until live mode is explicitly enabled.

---

## ⚠️ Safety First

**Live trading is disabled by default.** The engine will only place real orders when ALL of the following are true:
- `LIVE_TRADING_ENABLED=true` is set in the environment
- `BOT_MODE=LIVE` is set in bot settings
- A real broker connector is configured
- Risk limits are configured

---

## Running Locally

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and ADMIN_API_KEY at minimum

# 3. Start the engine
python run.py
# or: uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

The engine auto-creates all database tables and seeds default data on first start.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `ADMIN_API_KEY` | `change-me-in-production` | API key for all admin endpoints |
| `BOT_MODE` | `PAPER` | `PAPER` or `LIVE` |
| `LIVE_TRADING_ENABLED` | `false` | Must be `true` to allow live orders |
| `BOT_CYCLE_INTERVAL` | `60` | Seconds between strategy cycles |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `TELEGRAM_BOT_TOKEN` | empty | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | empty | Telegram chat ID for alerts |
| `EMAIL_SMTP_HOST` | empty | SMTP host for email alerts |

---

## Paper Trading Mode (Default)

Paper trading simulates all trades with a virtual balance (default: $10,000) without touching real money.

```bash
# Start the bot in paper mode (default)
curl -X POST http://localhost:8001/bot/start \
  -H "x-api-key: your-admin-api-key"

# Check status
curl http://localhost:8001/bot/status \
  -H "x-api-key: your-admin-api-key"

# Manually trigger a strategy cycle
curl -X POST http://localhost:8001/bot/run-cycle \
  -H "x-api-key: your-admin-api-key"

# View paper trades
curl http://localhost:8001/trades \
  -H "x-api-key: your-admin-api-key"
```

---

## Admin API Endpoints

All endpoints require the `x-api-key` header.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/bot/status` | Bot state and mode |
| `POST` | `/bot/start` | Start the bot |
| `POST` | `/bot/stop` | Stop the bot |
| `POST` | `/bot/pause` | Pause the bot |
| `POST` | `/bot/resume` | Resume after pause |
| `POST` | `/bot/emergency-stop` | Trigger emergency stop |
| `POST` | `/bot/clear-emergency-stop` | Clear emergency stop |
| `POST` | `/bot/run-cycle` | Manually run one strategy cycle |
| `GET` | `/strategies` | List all strategies |
| `POST` | `/strategies` | Create a strategy |
| `PUT` | `/strategies/{id}` | Update a strategy |
| `DELETE` | `/strategies/{id}` | Delete a strategy |
| `GET` | `/trades` | List trades |
| `GET` | `/signals` | List signals |
| `GET` | `/risk/status` | Risk status and limits |
| `PUT` | `/risk/limits` | Update risk limits |
| `GET` | `/logs` | View bot logs |

Interactive docs: `http://localhost:8001/docs`

---

## Adding a Broker API

To connect a real broker (Trading 212, Capital.com, MetaTrader, etc.):

1. Create `app/brokers/my_broker.py`
2. Extend `BrokerConnector` from `app/brokers/base.py`
3. Implement all abstract methods: `connect`, `get_account_balance`, `get_open_positions`, `get_market_price`, `place_order`, `close_position`, `cancel_order`, `is_market_open`
4. Register it in `app/brokers/__init__.py`:
   ```python
   from app.brokers.my_broker import MyBrokerConnector
   # In get_broker():
   if connector_name == "my_broker":
       return MyBrokerConnector(**kwargs)
   ```
5. Set `broker_connector=my_broker` in bot settings
6. Store real API keys as environment variables — **never in the database**

---

## Adding a Strategy

1. Create `app/strategies/my_strategy.py`
2. Extend `BaseStrategy` from `app/strategies/base.py`
3. Implement `generate_signal(prices, **kwargs) -> StrategySignal`
4. Register it in `app/strategies/__init__.py`:
   ```python
   STRATEGY_REGISTRY["my_strategy"] = MyStrategy
   ```
5. Create a database record via `POST /strategies` with `"name": "my_strategy"`

---

## Project Structure

```
app/
├── main.py            # FastAPI app + lifespan
├── config.py          # Settings from env vars
├── database.py        # SQLAlchemy engine + session
├── models/            # 12 database models
├── schemas/           # Pydantic schemas
├── api/               # FastAPI routers
│   └── routes/        # health, bot, strategies, trades, risk, logs
├── services/          # Bot engine + paper trading
├── strategies/        # Strategy framework + MA crossover
├── brokers/           # Broker interface + mock connector
├── risk/              # Risk management checks
├── alerts/            # Telegram + email alerts
├── logs/              # Structured logging
└── workers/           # APScheduler background jobs
```

---

## Security Notes

- All admin endpoints require `x-api-key` header
- Real broker API keys must be stored as environment variables only
- The database stores metadata references, never raw API credentials
- Emergency stop persists across restarts — must be explicitly cleared
- Live trading requires two independent safeguards: env var + bot settings
