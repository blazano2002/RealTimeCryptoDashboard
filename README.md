<div align="center">

# ₿ Real-Time Bitcoin Dashboard

**A production-grade, full-stack live trading dashboard.**  
Streams every BTC/USDT trade from Binance, stores it in TimescaleDB, and renders it as a professional live candlestick chart with order flow analysis — all in real-time with sub-second latency.

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-pg14-FDB515?style=flat-square&logo=postgresql&logoColor=white)](https://timescale.com)
[![Redis](https://img.shields.io/badge/Redis-alpine-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](LICENSE)

<br/>

</div>

---

## Architecture

```
Binance WebSocket
wss://stream.binance.com/ws/btcusdt@trade
         │
         ▼
┌─────────────────────┐   batch (50 trades)   ┌───────────────────┐
│   ingestion.py      │ ─────────────────────▶│   TimescaleDB     │
│   (ingester)        │                        │   (hypertable)    │
└──────────┬──────────┘                        └─────────┬─────────┘
           │  publish every trade                        │
           ▼                                             │
┌─────────────────────┐                       ┌─────────▼─────────┐
│   Redis pub/sub     │ ─────────────────────▶│   server.py       │
└─────────────────────┘   subscribe            │   (FastAPI)       │
                                               └─────────┬─────────┘
                                                         │  REST + WebSocket
                                               ┌─────────▼─────────┐
                                               │   React Frontend  │
                                               │   (Vite + TS)     │
                                               └───────────────────┘
```

| Service | Role | Technology |
|---|---|---|
| `ingestion.py` | Connects to Binance, classifies trade side, batches to DB, publishes to Redis | Python · asyncpg · websockets |
| `server.py` | Serves OHLCV history, 24h stats via REST; relays live trades over WebSocket | FastAPI · asyncpg · redis-py |
| TimescaleDB | Persistent time-series storage; `time_bucket` aggregation | PostgreSQL + TimescaleDB |
| Redis | In-memory pub/sub message bus — zero-latency broadcast to all clients | Redis |
| Frontend | Live chart, order flow, trade feed, stats display | React 18 · TypeScript · lightweight-charts |

---

## Features

**Chart**
- Live 1-minute OHLCV candlesticks via TradingView's `lightweight-charts`
- Volume histogram beneath the chart, green/red tinted by candle direction
- Line chart mode toggle
- Time range selector — 1H · 4H · 24H (dynamic bucket sizing)
- 24 hours of history pre-loaded on connect

**Market intelligence**
- 24h stats bar — High / Low / Volume / % Change / Trade Count
- Order flow bar — real buy vs. sell pressure using Binance's market-maker flag
- Momentum tracker — buy % across last 5, 20, and 50 trades
- 5-tick price velocity
- Live trade feed — timestamped rows, color-coded by side

**UX**
- Animated price ticker — green/red flash on direction change
- Price sparkline in the header
- Connection status with auto-reconnect and exponential backoff
- Loading overlay while history fetches

---

## Project Structure

```
RealTimeCryptoDashboard/
│
├── backend/
│   ├── .dockerignore
│   ├── Dockerfile
│   ├── ingestion.py          # Binance ingester · Redis publisher · DB writer
│   ├── requirements.txt
│   └── server.py             # FastAPI: /api/history · /api/stats · /ws/live
│
├── frontend/
│   ├── .dockerignore
│   ├── .env.local.example    # ← copy to .env.local for local dev
│   ├── Dockerfile
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── src/
│   │   ├── assets/
│   │   ├── App.css
│   │   ├── App.tsx           # Main dashboard component
│   │   ├── index.css
│   │   └── main.tsx
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
│
├── .env.example              # ← copy to .env and fill in secrets
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) — nothing else required.

### 1. Clone the repository

```bash
git clone https://github.com/blazano2002/RealTimeCryptoDashboard.git
cd RealTimeCryptoDashboard
```

### 2. Configure environment variables

There are two environment files to create — one for the backend/Docker stack and one for the Vite frontend.

**Root — backend + Docker Compose:**

```bash
cp .env.example .env
```

Edit `.env`:

```env
BINANCE_WS_URL=wss://stream.binance.com:9443/ws/btcusdt@trade
REDIS_URL=redis://redis:6379
REDIS_CHANNEL=live_trades
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@db:5432/postgres
FRONTEND_URL=http://localhost:5173
```

> The hostnames `redis` and `db` are Docker Compose service names. They resolve automatically inside the Docker network — no changes needed unless running without Docker.

**Frontend — Vite dev server:**

```bash
cp frontend/.env.local.example frontend/.env.local
```

The default values work out of the box for local development:

```env
VITE_WS_URL=ws://localhost:8000/ws/live
VITE_API_URL=http://localhost:8000/api/history
VITE_STATS_URL=http://localhost:8000/api/stats
```

### 3. Launch

```bash
docker compose up --build
```

This single command starts all five services in the correct order:

1. TimescaleDB — waits until `pg_isready` passes
2. Redis — waits until `redis-cli ping` passes
3. FastAPI backend — starts after both DB and Redis are healthy
4. Ingestion service — connects to Binance immediately
5. React frontend — served on port 5173

### 4. Open

```
http://localhost:5173
```

---

## Environment Variables Reference

### Root `.env` — backend and Docker Compose

| Variable | Description | Docker Compose value |
|---|---|---|
| `BINANCE_WS_URL` | Binance trade stream URL | `wss://stream.binance.com:9443/ws/btcusdt@trade` |
| `REDIS_URL` | Redis connection string | `redis://redis:6379` |
| `REDIS_CHANNEL` | Pub/sub channel name | `live_trades` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:PASSWORD@db:5432/postgres` |
| `FRONTEND_URL` | Allowed CORS origin | `http://localhost:5173` |

### `frontend/.env.local` — Vite frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_WS_URL` | WebSocket endpoint | `ws://localhost:8000/ws/live` |
| `VITE_API_URL` | History REST endpoint | `http://localhost:8000/api/history` |
| `VITE_STATS_URL` | Stats REST endpoint | `http://localhost:8000/api/stats` |

> All `VITE_` prefixed variables are injected at build time by Vite and become part of the compiled JS bundle. They are not secret — do not store API keys here.

---

## API Reference

### `GET /api/history?range=24H`

Returns OHLCV candlestick data aggregated by TimescaleDB.

| Parameter | Values | Bucket size |
|---|---|---|
| `range=1H` | Last 1 hour | 10-second candles |
| `range=4H` | Last 4 hours | 1-minute candles |
| `range=24H` (default) | Last 24 hours | 1-minute candles |

```json
[
  {
    "time": 1718000000,
    "open": 67432.10,
    "high": 67489.55,
    "low": 67401.22,
    "close": 67455.80,
    "volume": 2.3841
  }
]
```

### `GET /api/stats`

Returns 24-hour market statistics computed in a single DB query.

```json
{
  "high_24h": 68100.00,
  "low_24h": 66250.50,
  "volume_24h": 1482.33,
  "change_24h": 1.24,
  "trade_count": 184291
}
```

### `WS /ws/live`

On connect, sends one `initial_state` message with the latest cached price from Redis, then streams a `live_trade` event for every Binance trade.

```json
{ "type": "initial_state", "price": 67455.80 }

{
  "type": "live_trade",
  "data": {
    "symbol": "BTC/USDT",
    "price": 67460.10,
    "volume": 0.00412,
    "side": "buy",
    "timestamp": 1718000001234
  }
}
```

---

## Running Without Docker

If you prefer to run the Python and Node processes directly:

```bash
# Start infrastructure
docker run --name realtime-redis -p 6379:6379 -d redis:alpine
docker run -d --name realtime-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=supersecret \
  timescale/timescaledb:latest-pg14
```

Update the root `.env` to use `localhost` instead of Docker service names:

```env
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgres://postgres:supersecret@localhost:5432/postgres
```

**Backend (two terminals):**

```bash
cd backend
pip install -r requirements.txt

uvicorn server:app --reload --port 8000   # terminal 1
python ingestion.py                       # terminal 2
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

---

## How It Works

### Buy/sell side classification

Binance's trade stream includes an `m` field — whether the buyer is the market maker (passive side). A seller who aggressively fills a resting buy order is the aggressor:

```python
side = "sell" if data["m"] else "buy"
```

This is the standard convention used by all professional trading systems and powers the order flow bar and momentum tracker in the UI.

### Candlestick aggregation

The query delegates entirely to TimescaleDB — no candle-building logic in Python:

```sql
SELECT
    EXTRACT(EPOCH FROM time_bucket('1 minute', time))::bigint AS time,
    first(price, time)  AS open,
    max(price)          AS high,
    min(price)          AS low,
    last(price, time)   AS close,
    sum(volume)         AS volume
FROM trades
WHERE time >= NOW() - INTERVAL '24 hours'
GROUP BY time_bucket('1 minute', time)
ORDER BY time_bucket('1 minute', time) ASC;
```

`first()` and `last()` are TimescaleDB hyperfunctions that return the price at the earliest and latest timestamp in each bucket — giving accurate open and close regardless of insertion order.

### Batch writes

Trades are published to Redis immediately (microseconds), then buffered in memory and flushed to TimescaleDB in batches of 50. This reduces DB round-trips from ~600/minute to ~12/minute. The buffer is flushed to disk before every reconnect attempt so no data is lost on disconnect.

### Live candle updates in the frontend

`currentCandleRef` tracks the active 1-minute bucket. Each WebSocket trade either opens a new candle or updates the current one's high, low, close, and volume in-place. Trades with a timestamp older than the current bucket are silently dropped to maintain chart time integrity.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Data source | Binance WebSocket API | Sub-millisecond trade stream |
| Message bus | Redis pub/sub | Zero-latency fan-out to all connected clients |
| Database | TimescaleDB | `time_bucket`, `first()`/`last()` hyperfunctions, automatic partitioning |
| Backend | FastAPI | Async-native, WebSocket support, fast cold start |
| DB driver | asyncpg | Fastest async PostgreSQL driver for Python |
| Frontend | React 18 + TypeScript | Component model, strict typing |
| Charting | lightweight-charts | TradingView's open-source GPU-accelerated chart library |
| Bundler | Vite | Instant HMR, `import.meta.env` for build-time env injection |
| Containers | Docker Compose | One-command reproducible environment with health checks |

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Binance WebSocket · TimescaleDB · Redis · FastAPI · React · Docker</sub>
</div>