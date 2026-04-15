import asyncio
import json
import logging
import os
import sys

import asyncpg
import redis.asyncio as redis
import websockets
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        logging.critical(f"Missing required environment variable: {name}")
        sys.exit(1)
    return value

BINANCE_WS_URL  = _require("BINANCE_WS_URL")
REDIS_URL       = _require("REDIS_URL")
REDIS_CHANNEL   = _require("REDIS_CHANNEL")
DATABASE_URL    = _require("DATABASE_URL")

BATCH_SIZE = 50          # flush to DB every N trades
RECONNECT_DELAY_MAX = 60 # max seconds between reconnect attempts


# ─── DATABASE SETUP ───────────────────────────────────────────────────────────

async def init_db(conn: asyncpg.Connection) -> None:

    # Create table using 'time' to match the original schema (already a hypertable)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            time    TIMESTAMPTZ      NOT NULL,
            symbol  TEXT             NOT NULL,
            price   DOUBLE PRECISION NOT NULL,
            volume  DOUBLE PRECISION NOT NULL
        );
    """)

    # Add 'side' column if it doesn't exist yet (safe migration)
    await conn.execute("""
        ALTER TABLE trades ADD COLUMN IF NOT EXISTS side TEXT;
    """)

    # TimescaleDB hypertable — silently skip if already set up
    try:
        await conn.execute(
            "SELECT create_hypertable('trades', 'time', if_not_exists => TRUE);"
        )
        logging.info("TimescaleDB hypertable ready.")
    except Exception as e:
        if "already a hypertable" not in str(e):
            logging.warning(f"Hypertable setup warning: {e}")

    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_trades_symbol_time
        ON trades (symbol, time DESC);
    """)


# ─── MAIN INGESTION LOOP ──────────────────────────────────────────────────────

async def run_ingester() -> None:
    # One-time DB init
    conn = await asyncpg.connect(DATABASE_URL)
    await init_db(conn)
    await conn.close()

    redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=5)

    trade_buffer: list[tuple] = []
    reconnect_delay = 1

    while True:
        try:
            logging.info(f"Connecting to Binance: {BINANCE_WS_URL}")
            async with websockets.connect(
                BINANCE_WS_URL,
                ping_interval=20,
                ping_timeout=10,
            ) as ws:
                logging.info("Connected to Binance WebSocket ✓")
                reconnect_delay = 1  # Reset on successful connect

                async for raw_msg in ws:
                    data = json.loads(raw_msg)

                    # Binance trade stream fields:
                    # E = event time (ms), p = price, q = quantity, m = is buyer market maker
                    trade_time = datetime.fromtimestamp(data["E"] / 1000.0, tz=timezone.utc)
                    price  = float(data["p"])
                    volume = float(data["q"])
                    # m=True means the buyer is the market maker → seller-initiated = sell
                    side   = "sell" if data["m"] else "buy"

                    # ── 1. LIVE BROADCAST via Redis pub/sub ─────────────────
                    payload = {
                        "symbol":    "BTC/USDT",
                        "price":     price,
                        "volume":    volume,
                        "side":      side,
                        "timestamp": data["E"],   # ms epoch for the frontend
                    }
                    await redis_client.publish(REDIS_CHANNEL, json.dumps(payload))
                    await redis_client.set("btc_latest_price", price)

                    # ── 2. BATCH INSERT into TimescaleDB ────────────────────
                    trade_buffer.append((trade_time, "BTC/USDT", price, volume, side))

                    if len(trade_buffer) >= BATCH_SIZE:
                        async with db_pool.acquire() as db_conn:
                            await db_conn.executemany(
                                """
                                INSERT INTO trades (time, symbol, price, volume, side)
                                VALUES ($1, $2, $3, $4, $5)
                                """,
                                trade_buffer,
                            )
                        logging.info(f"Flushed {BATCH_SIZE} trades → TimescaleDB")
                        trade_buffer.clear()

        except websockets.exceptions.ConnectionClosed as e:
            logging.warning(f"Connection closed ({e.code}). Reconnecting in {reconnect_delay}s…")
        except Exception as e:
            logging.error(f"Unexpected error: {e}")
        finally:
            if trade_buffer:
                try:
                    async with db_pool.acquire() as db_conn:
                        await db_conn.executemany(
                            "INSERT INTO trades (time, symbol, price, volume, side) VALUES ($1, $2, $3, $4, $5)",
                            trade_buffer,
                        )
                    logging.info(f"Flushed {len(trade_buffer)} buffered trades before reconnect.")
                    trade_buffer.clear()
                except Exception as flush_err:
                    logging.error(f"Flush error: {flush_err}")

        await asyncio.sleep(reconnect_delay)
        reconnect_delay = min(reconnect_delay * 2, RECONNECT_DELAY_MAX)


if __name__ == "__main__":
    asyncio.run(run_ingester())
