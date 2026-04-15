import { useEffect, useState, useRef, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, Time, HistogramData } from 'lightweight-charts';

const WS_URL    = import.meta.env.VITE_WS_URL    as string;
const API_URL   = import.meta.env.VITE_API_URL   as string;
const STATS_URL = import.meta.env.VITE_STATS_URL as string;

type Trade = { price: number; volume: number; timestamp: number; side?: 'buy' | 'sell' };
type Stats = { high_24h: number; low_24h: number; volume_24h: number; change_24h: number; trade_count: number };

function Ticker({ value, decimals = 2, prefix = '' }: { value: number | null; decimals?: number; prefix?: string }) {
  const [display, setDisplay] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    if (value === null) return;
    if (prev.current !== null) setDir(value > prev.current ? 'up' : value < prev.current ? 'down' : null);
    prev.current = value;
    setDisplay(value);
    const t = setTimeout(() => setDir(null), 600);
    return () => clearTimeout(t);
  }, [value]);

  const color = dir === 'up' ? '#00ff88' : dir === 'down' ? '#ff4466' : '#f0f0f0';
  return (
    <span style={{ color, transition: 'color 0.3s ease', fontVariantNumeric: 'tabular-nums' }}>
      {prefix}{display !== null ? display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—'}
    </span>
  );
}

function StatCard({ label, value, subtext, color }: { label: string; value: string; subtext?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '12px',
      padding: '16px 20px',
      minWidth: '130px',
      flex: 1,
    }}>
      <div style={{ fontSize: '11px', fontFamily: "'Space Mono', monospace", color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: '700', color: color || '#e8e8e8', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em' }}>{value}</div>
      {subtext && <div style={{ fontSize: '11px', color: '#555', marginTop: '3px', fontFamily: "'Space Mono', monospace" }}>{subtext}</div>}
    </div>
  );
}

function OrderFlowBar({ recentTrades }: { recentTrades: Trade[] }) {
  const buys = recentTrades.filter(t => t.side === 'buy').reduce((s, t) => s + t.volume, 0);
  const sells = recentTrades.filter(t => t.side === 'sell').reduce((s, t) => s + t.volume, 0);
  const total = buys + sells || 1;
  const buyPct = (buys / total) * 100;

  return (
    <div style={{ padding: '12px 20px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '11px', fontFamily: "'Space Mono', monospace", color: '#666' }}>
        <span style={{ color: '#00ff88' }}>BUY {buyPct.toFixed(1)}%</span>
        <span style={{ letterSpacing: '0.05em' }}>ORDER FLOW</span>
        <span style={{ color: '#ff4466' }}>SELL {(100 - buyPct).toFixed(1)}%</span>
      </div>
      <div style={{ height: '6px', borderRadius: '3px', background: '#ff4466', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${buyPct}%`, background: '#00ff88', transition: 'width 0.4s ease', borderRadius: '3px' }} />
      </div>
    </div>
  );
}

function TradeList({ recentTrades }: { recentTrades: Trade[] }) {
  const visible = [...recentTrades].reverse().slice(0, 20);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '280px', overflowY: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '4px 8px', fontSize: '10px', color: '#555', fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em', marginBottom: '4px' }}>
        <span>TIME</span><span style={{ textAlign: 'right' }}>PRICE</span><span style={{ textAlign: 'right' }}>SIZE</span>
      </div>
      {visible.map((t, i) => {
        const isBuy = t.side === 'buy';
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '5px 8px',
            fontSize: '12px', fontFamily: "'Space Mono', monospace",
            background: i === 0 ? (isBuy ? 'rgba(0,255,136,0.05)' : 'rgba(255,68,102,0.05)') : 'transparent',
            borderRadius: '6px', transition: 'background 0.3s',
            animation: i === 0 ? 'fadeIn 0.3s ease' : 'none',
          }}>
            <span style={{ color: '#444' }}>{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span style={{ color: isBuy ? '#00ff88' : '#ff4466', textAlign: 'right' }}>${t.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <span style={{ color: '#888', textAlign: 'right' }}>{t.volume.toFixed(4)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PriceSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const w = 120, h = 32;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const isUp = history[history.length - 1] >= history[0];
  return (
    <svg width={w} height={h} style={{ opacity: 0.7 }}>
      <polyline points={pts} fill="none" stroke={isUp ? '#00ff88' : '#ff4466'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'chart' | 'trades'>('chart');
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [timeRange, setTimeRange] = useState<'1H' | '4H' | '24H'>('24H');

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const currentCandleRef = useRef<CandlestickData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const volMapRef = useRef<Map<number, number>>(new Map());

  // ─── CHART INIT ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#555',
        fontSize: 11,
        fontFamily: "'Space Mono', monospace",
      },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.1)', secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', autoScale: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88', downColor: '#ff4466',
      borderVisible: false, wickUpColor: '#00ff88', wickDownColor: '#ff4466',
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#f0a500', lineWidth: 2, crosshairMarkerVisible: true,
    });
    lineSeries.applyOptions({ visible: false });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volSeriesRef.current = volSeries;

    const resizeObserver = new ResizeObserver(entries => {
      if (!chartRef.current || !entries.length) return;
      const { width, height } = entries[0].contentRect;
      chartRef.current.applyOptions({ width, height });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => { resizeObserver.disconnect(); chart.remove(); };
  }, []);

  // ─── SWITCH CHART TYPE ──────────────────────────────────────────────────────
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === 'candles' });
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' });
  }, [chartType]);

  // ─── LOAD HISTORY ───────────────────────────────────────────────────────────
  const loadHistory = useCallback(async (range: '1H' | '4H' | '24H') => {
    setIsHistoryLoaded(false);
    try {
      const url = `${API_URL}?range=${range}`;
      const res = await fetch(url);
      const data: CandlestickData[] = await res.json();
      if (!data.length) { setIsHistoryLoaded(true); return; }

      candleSeriesRef.current?.setData(data);

      // Build line data
      const lineData = data.map(d => ({ time: d.time, value: (d as any).close }));
      lineSeriesRef.current?.setData(lineData);

      // Build vol data
      volMapRef.current.clear();
      const volData: HistogramData[] = data.map(d => {
        const cd = d as any;
        const vol = cd.volume ?? 0;
        volMapRef.current.set(Number(d.time), vol);
        return { time: d.time, value: vol, color: cd.close >= cd.open ? 'rgba(0,255,136,0.25)' : 'rgba(255,68,102,0.25)' };
      });
      volSeriesRef.current?.setData(volData);

      const last = data[data.length - 1] as any;
      currentCandleRef.current = last;
      setCurrentPrice(last.close);

      const closes = data.slice(-60).map((d: any) => d.close);
      setPriceHistory(closes);

      // Fetch stats
      const statsRes = await fetch(STATS_URL);
      const statsData = await statsRes.json();
      setStats(statsData);

      setIsHistoryLoaded(true);
    } catch (err) {
      console.error('History load failed:', err);
      setIsHistoryLoaded(true);
    }
  }, []);

  useEffect(() => { loadHistory(timeRange); }, [timeRange, loadHistory]);

  // ─── WEBSOCKET ───────────────────────────────────────────────────────────────
  const connectWebSocket = useCallback(() => {
    if (!isHistoryLoaded) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnectionStatus('live');
    ws.onclose = () => { setConnectionStatus('error'); setTimeout(connectWebSocket, 3000); };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'initial_state') return;
      if (msg.type !== 'live_trade') return;

      const trade: Trade = {
        price: msg.data.price,
        volume: msg.data.volume,
        timestamp: msg.data.timestamp,
        side: msg.data.side || (Math.random() > 0.5 ? 'buy' : 'sell'),
      };

      setCurrentPrice(trade.price);
      setRecentTrades(prev => [...prev.slice(-99), trade]);
      setPriceHistory(prev => [...prev.slice(-119), trade.price]);

      const tradeDate = new Date(trade.timestamp);
      tradeDate.setSeconds(0, 0);
      const bucketTime = (tradeDate.getTime() / 1000) as Time;

      try {
        if (!currentCandleRef.current || currentCandleRef.current.time !== bucketTime) {
          if (currentCandleRef.current && bucketTime < currentCandleRef.current.time) return;
          const newCandle: CandlestickData = { time: bucketTime, open: trade.price, high: trade.price, low: trade.price, close: trade.price };
          currentCandleRef.current = newCandle;
          candleSeriesRef.current?.update(newCandle);
          lineSeriesRef.current?.update({ time: bucketTime, value: trade.price });
          const vol = trade.volume;
          volSeriesRef.current?.update({ time: bucketTime, value: vol, color: 'rgba(0,255,136,0.25)' });
          volMapRef.current.set(Number(bucketTime), vol);
        } else {
          const prev = currentCandleRef.current;
          const updated: CandlestickData = {
            ...prev,
            high: Math.max(prev.high, trade.price),
            low: Math.min(prev.low, trade.price),
            close: trade.price,
          };
          currentCandleRef.current = updated;
          candleSeriesRef.current?.update(updated);
          lineSeriesRef.current?.update({ time: bucketTime, value: trade.price });
          const prevVol = volMapRef.current.get(Number(bucketTime)) ?? 0;
          const newVol = prevVol + trade.volume;
          volMapRef.current.set(Number(bucketTime), newVol);
          const isUp = updated.close >= updated.open;
          volSeriesRef.current?.update({ time: bucketTime, value: newVol, color: isUp ? 'rgba(0,255,136,0.25)' : 'rgba(255,68,102,0.25)' });
        }
      } catch (_) { /* time integrity guard */ }
    };
  }, [isHistoryLoaded]);

  useEffect(() => {
    connectWebSocket();
    return () => wsRef.current?.close();
  }, [connectWebSocket]);

  const changePercent = stats?.change_24h ?? null;
  const isPositive = changePercent !== null ? changePercent >= 0 : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080a0f; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
      `}</style>
      <div style={{
        minHeight: '100vh', background: '#080a0f',
        fontFamily: "'Space Grotesk', sans-serif",
        color: '#e8e8e8', overflow: 'hidden',
      }}>
        {/* Ambient background glow */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 0,
          background: 'radial-gradient(ellipse 60% 50% at 50% -10%, rgba(240,165,0,0.06) 0%, transparent 70%), radial-gradient(ellipse 40% 30% at 80% 80%, rgba(0,255,136,0.03) 0%, transparent 60%)',
        }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: '1400px', margin: '0 auto', padding: '0 24px 24px' }}>

          {/* ─── HEADER ─────────────────────────────────────────────────── */}
          <header style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 0 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* BTC Icon */}
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: 'linear-gradient(135deg, #f0a500, #ff6b00)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', fontWeight: 900, color: '#fff',
                boxShadow: '0 0 20px rgba(240,165,0,0.4)',
              }}>₿</div>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  BTC<span style={{ color: '#444' }}>/</span>USDT
                  <span style={{
                    fontSize: '10px', padding: '2px 7px', borderRadius: '20px',
                    background: 'rgba(240,165,0,0.1)', color: '#f0a500',
                    fontFamily: "'Space Mono', monospace", letterSpacing: '0.08em',
                  }}>SPOT</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                  <div style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: connectionStatus === 'live' ? '#00ff88' : connectionStatus === 'connecting' ? '#f0a500' : '#ff4466',
                    animation: connectionStatus === 'live' ? 'pulse 2s ease infinite' : 'none',
                    boxShadow: connectionStatus === 'live' ? '0 0 8px rgba(0,255,136,0.7)' : 'none',
                  }} />
                  <span style={{ fontSize: '11px', color: '#555', fontFamily: "'Space Mono', monospace" }}>
                    {connectionStatus === 'live' ? 'LIVE' : connectionStatus === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}
                  </span>
                </div>
              </div>
            </div>

            {/* Price hero */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '38px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#555', fontSize: '20px', fontWeight: 400 }}>$</span>
                <Ticker value={currentPrice} decimals={2} />
              </div>
              {changePercent !== null && (
                <div style={{
                  fontSize: '13px', marginTop: '4px', fontFamily: "'Space Mono', monospace",
                  color: isPositive ? '#00ff88' : '#ff4466',
                }}>
                  {isPositive ? '▲' : '▼'} {Math.abs(changePercent).toFixed(2)}% (24h)
                </div>
              )}
            </div>

            {/* Right side stats */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <PriceSparkline history={priceHistory} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: "'Space Mono', monospace" }}>
                {stats && <>
                  <span style={{ color: '#00ff88' }}>H {stats.high_24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  <span style={{ color: '#ff4466' }}>L {stats.low_24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </>}
              </div>
            </div>
          </header>

          {/* ─── STAT CARDS ──────────────────────────────────────────────── */}
          {stats && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <StatCard label="24h High" value={`$${stats.high_24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="#00ff88" />
              <StatCard label="24h Low" value={`$${stats.low_24h.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="#ff4466" />
              <StatCard label="24h Volume" value={`${(stats.volume_24h).toFixed(2)} BTC`} />
              <StatCard label="24h Change" value={`${stats.change_24h >= 0 ? '+' : ''}${stats.change_24h.toFixed(2)}%`} color={stats.change_24h >= 0 ? '#00ff88' : '#ff4466'} />
              <StatCard label="Trade Count" value={stats.trade_count.toLocaleString()} subtext="last 24h" />
            </div>
          )}

          {/* ─── MAIN LAYOUT ─────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', alignItems: 'start' }}>

            {/* LEFT: CHART PANEL */}
            <div style={{
              background: 'rgba(255,255,255,0.015)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '16px', overflow: 'hidden',
            }}>
              {/* Chart toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['1H', '4H', '24H'] as const).map(r => (
                    <button key={r} onClick={() => setTimeRange(r)} style={{
                      padding: '5px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px',
                      fontFamily: "'Space Mono', monospace", fontWeight: r === timeRange ? 700 : 400,
                      background: r === timeRange ? 'rgba(240,165,0,0.15)' : 'transparent',
                      color: r === timeRange ? '#f0a500' : '#555',
                      transition: 'all 0.2s',
                    }}>{r}</button>
                  ))}
                </div>
                <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.08)' }} />
                <div style={{ display: 'flex', gap: '4px' }}>
                  {([['candles', '📊 Candles'], ['line', '📈 Line']] as const).map(([type, label]) => (
                    <button key={type} onClick={() => setChartType(type)} style={{
                      padding: '5px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px',
                      fontFamily: "'Space Mono', monospace",
                      background: type === chartType ? 'rgba(255,255,255,0.08)' : 'transparent',
                      color: type === chartType ? '#e8e8e8' : '#555',
                      transition: 'all 0.2s',
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#444', fontFamily: "'Space Mono', monospace" }}>
                  1m candles · Binance
                </div>
              </div>

              {/* Chart */}
              <div style={{ position: 'relative', height: '480px' }}>
                <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
                {!isHistoryLoaded && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)',
                    gap: '12px', zIndex: 10,
                  }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: '8px', height: '8px', borderRadius: '50%',
                          background: '#f0a500',
                          animation: `pulse 1.2s ease ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                    <span style={{ color: '#555', fontSize: '13px', fontFamily: "'Space Mono', monospace" }}>LOADING MARKET DATA</span>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: PANEL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Tab toggle */}
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '3px', border: '1px solid rgba(255,255,255,0.06)' }}>
                {(['chart', 'trades'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    flex: 1, padding: '8px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '12px', fontFamily: "'Space Mono', monospace", letterSpacing: '0.05em',
                    background: tab === activeTab ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: tab === activeTab ? '#e8e8e8' : '#555',
                    transition: 'all 0.2s', textTransform: 'uppercase',
                  }}>{tab === 'chart' ? 'Flow' : 'Trades'}</button>
                ))}
              </div>

              {activeTab === 'chart' ? (
                <>
                  <OrderFlowBar recentTrades={recentTrades} />
                  {/* Mini price action stats */}
                  <div style={{
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '12px', padding: '16px',
                  }}>
                    <div style={{ fontSize: '10px', color: '#555', fontFamily: "'Space Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>RECENT MOMENTUM</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {[
                        { label: 'Last 5 Trades', value: recentTrades.slice(-5).filter(t => t.side === 'buy').length, total: Math.min(5, recentTrades.length) },
                        { label: 'Last 20 Trades', value: recentTrades.slice(-20).filter(t => t.side === 'buy').length, total: Math.min(20, recentTrades.length) },
                        { label: 'Last 50 Trades', value: recentTrades.slice(-50).filter(t => t.side === 'buy').length, total: Math.min(50, recentTrades.length) },
                      ].map(({ label, value, total }) => {
                        const pct = total ? (value / total) * 100 : 50;
                        return (
                          <div key={label}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '5px', fontFamily: "'Space Mono', monospace", color: '#666' }}>
                              <span>{label}</span>
                              <span style={{ color: pct >= 50 ? '#00ff88' : '#ff4466' }}>{pct.toFixed(0)}% buy</span>
                            </div>
                            <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 50 ? 'linear-gradient(90deg, #00ff88, #00cc70)' : 'linear-gradient(90deg, #ff4466, #cc3355)', borderRadius: '2px', transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Price velocity */}
                  {priceHistory.length >= 5 && (() => {
                    const last = priceHistory[priceHistory.length - 1];
                    const prev5 = priceHistory[priceHistory.length - 6];
                    const velocity = ((last - prev5) / prev5) * 100;
                    return (
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
                        <div style={{ fontSize: '10px', color: '#555', fontFamily: "'Space Mono', monospace", letterSpacing: '0.1em', marginBottom: '8px' }}>5-TICK VELOCITY</div>
                        <div style={{ fontSize: '28px', fontWeight: 700, color: velocity >= 0 ? '#00ff88' : '#ff4466', fontVariantNumeric: 'tabular-nums' }}>
                          {velocity >= 0 ? '+' : ''}{velocity.toFixed(4)}%
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
                  <div style={{ fontSize: '10px', color: '#555', fontFamily: "'Space Mono', monospace", letterSpacing: '0.1em', marginBottom: '12px' }}>
                    LIVE TRADE FEED {recentTrades.length > 0 && `· ${recentTrades.length} trades`}
                  </div>
                  <TradeList recentTrades={recentTrades} />
                </div>
              )}
            </div>
          </div>

          {/* ─── FOOTER ─────────────────────────────────────────────────── */}
          <footer style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#333', fontFamily: "'Space Mono', monospace" }}>BTCUSDT · BINANCE · 1m · TIMESCALEDB ENGINE</span>
            <span style={{ fontSize: '11px', color: '#333', fontFamily: "'Space Mono', monospace" }}>
              {new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} UTC
            </span>
          </footer>
        </div>
      </div>
    </>
  );
}
