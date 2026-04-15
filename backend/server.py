import json
import logging
import os
import sys

import asyncpg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as redis
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# ─── CONFIG — fail immediately if any required variable is missing ─────────────

def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        logging.critical(f"Missing required environment variable: {name}")
        sys.exit(1)
    return value

FRONTEND_URL  = _require("FRONTEND_URL")
REDIS_URL     = _require("REDIS_URL")
REDIS_CHANNEL = _require("REDIS_CHANNEL")
DATABASE_URL  = _require("DATABASE_URL")


# ─── APP SETUP ────────────────────────────────────────────────────────────────

app = FastAPI(title="BTC Pro Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_pool = redis.ConnectionPool.from_url(REDIS_URL, decode_responses=True)

RANGE_INTERVALS = {
    "1H":  ("1 hour",   "10 seconds"),
    "4H":  ("4 hours",  "1 minute"),
    "24H": ("24 hours", "1 minute"),
}

# ─── REST ENDPOINTS ───────────────────────────────────────────────────────────

@app.get("/api/history")
async def get_history(range: str = Query("24H", regex="^(1H|4H|24H)$")):

    interval, bucket = RANGE_INTERVALS.get(range, ("24 hours", "1 minute"))

    query = f"""
        SELECT
            EXTRACT(EPOCH FROM time_bucket('{bucket}', time))::bigint AS time,
            first(price, time)   AS open,
            max(price)           AS high,
            min(price)           AS low,
            last(price, time)    AS close,
            sum(volume)          AS volume
        FROM trades
        WHERE time >= NOW() - INTERVAL '{interval}'
          AND symbol = 'BTC/USDT'
        GROUP BY time_bucket('{bucket}', time)
        ORDER BY time_bucket('{bucket}', time) ASC;
    """

    try:
        conn = await asyncpg.connect(DATABASE_URL)
        rows = await conn.fetch(query)
        await conn.close()
        return [dict(row) for row in rows]
    except Exception as e:
        logging.error(f"History query error: {e}")
        return []


@app.get("/api/stats")
async def get_stats():

    query = """
        SELECT
            max(price)         AS high_24h,
            min(price)         AS low_24h,
            sum(volume)        AS volume_24h,
            count(*)           AS trade_count,
            first(price, time) AS open_24h,
            last(price, time)  AS close_24h
        FROM trades
        WHERE time >= NOW() - INTERVAL '24 hours'
          AND symbol = 'BTC/USDT';
    """
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        row = await conn.fetchrow(query)
        await conn.close()

        if not row or row["open_24h"] is None:
            return {"high_24h": 0, "low_24h": 0, "volume_24h": 0, "change_24h": 0, "trade_count": 0}

        open_p  = float(row["open_24h"])
        close_p = float(row["close_24h"])
        change  = ((close_p - open_p) / open_p) * 100 if open_p else 0

        return {
            "high_24h":   float(row["high_24h"]),
            "low_24h":    float(row["low_24h"]),
            "volume_24h": float(row["volume_24h"]),
            "change_24h": round(change, 4),
            "trade_count": int(row["trade_count"]),
        }
    except Exception as e:
        logging.error(f"Stats query error: {e}")
        return {"high_24h": 0, "low_24h": 0, "volume_24h": 0, "change_24h": 0, "trade_count": 0}


# ─── WEBSOCKET ────────────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    redis_client = redis.Redis(connection_pool=redis_pool)
    pubsub = redis_client.pubsub()

    try:
        # Send the latest cached price instantly on connect
        latest_price = await redis_client.get("btc_latest_price")
        if latest_price:
            await websocket.send_json({
                "type": "initial_state",
                "price": float(latest_price),
            })

        await pubsub.subscribe(REDIS_CHANNEL)

        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_json({
                    "type": "live_trade",
                    "data": json.loads(message["data"]),
                })

    except WebSocketDisconnect:
        logging.info("Client disconnected cleanly.")
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
    finally:
        await pubsub.unsubscribe(REDIS_CHANNEL)
        await pubsub.close()