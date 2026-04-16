import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  ReferenceLine,
} from "recharts";

/* ━━ Palette ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const P = {
  bg:       "#0c0c0e",
  surface:  "#141416",
  raised:   "#1a1a1e",
  border:   "#25252b",
  borderLt: "#2e2e36",

  text:     "#e4e4e7",
  text2:    "#83838f",
  text3:    "#53535e",

  acc:      "#c4f251",
  accDim:   "rgba(196,242,81,0.10)",
  accMid:   "rgba(196,242,81,0.25)",

  green:    "#4ade80",
  amber:    "#fbbf24",
  red:      "#f87171",

  a1:       "#c4f251",  // personal — chartreuse
  a2:       "#e8915a",  // lab — warm coral
  a3:       "#7c83ff",  // work — cool indigo
};

const COLOR_PALETTE = [P.a1, P.a2, P.a3, P.green, P.amber];
const ACC_COLORS = { personal: P.a1, lab: P.a2, work: P.a3 };
const colorFor = (acc, idx) => ACC_COLORS[acc.id] || COLOR_PALETTE[idx % COLOR_PALETTE.length];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ━━ Formatters ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const fmtTokens = (n) => {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
};
const fmtCost = (n) => "$" + (n || 0).toFixed(n < 0.01 ? 4 : n < 1 ? 3 : 2);
const fmtHHMM = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
};
const fmtUpdated = (iso) => {
  if (!iso) return "—";
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60)  return `updated ${Math.floor(secs)}s ago`;
  if (secs < 3600) return `updated ${Math.floor(secs/60)}m ago`;
  return `updated ${Math.floor(secs/3600)}h ago`;
};

/* ━━ Stats builder ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function buildStats(account) {
  const b = account.current_block;
  const limit = account.token_limit_5h || 0;
  const used = b?.total_tokens || 0;
  return {
    tokens:    b ? fmtTokens(b.total_tokens) : "—",
    burn:      b ? fmtTokens(b.burn_rate_per_hour) : "—",
    cost:      b ? fmtCost(b.cost_usd) : "—",
    blockTime: b ? `${fmtHHMM(b.start_time)}–${fmtHHMM(b.end_time)}` : "—",
    used:      fmtTokens(used),
    limit:     fmtTokens(limit),
    pct:       account.limit_pct || 0,
    reset:     b ? `${b.time_remaining_min}m` : "—",
    today:     fmtTokens(account.today?.total_tokens || 0),
    todayCost: fmtCost(account.today?.cost_usd || 0),
    month:     fmtTokens(account.this_month?.total_tokens || 0),
    monthCost: fmtCost(account.this_month?.cost_usd || 0),
    isLive:    !!(b && b.is_active),
  };
}

/* ━━ Chart data builders ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function buildMonthData(accounts, year, monthIdx) {
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const now = new Date();
  const isCurrent = year === now.getFullYear() && monthIdx === now.getMonth();
  const currentDay = isCurrent ? now.getDate() : daysInMonth;

  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const row = { day: d, label: String(d), future: d > currentDay };
    accounts.forEach((a) => {
      const entry = (a.daily_history || []).find((h) => h.date === dateStr);
      row[`${a.id}_tokens`] = entry ? +(entry.total_tokens / 1e6).toFixed(3) : 0;
      row[`${a.id}_cost`]   = entry ? +entry.cost_usd.toFixed(3) : 0;
    });
    return row;
  });
}

function buildCumData(data, accounts, sfx) {
  const sums = Object.fromEntries(accounts.map((a) => [a.id, 0]));
  return data.map((d) => {
    if (!d.future) {
      accounts.forEach((a) => {
        sums[a.id] += d[`${a.id}${sfx}`];
      });
    }
    const out = { ...d };
    accounts.forEach((a) => {
      out[`${a.id}${sfx}_cum`] = +sums[a.id].toFixed(3);
    });
    return out;
  });
}

/* ━━ Tiny components ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const Dot = () => (
  <span style={{ color: P.text3, margin: "0 6px", fontSize: 8, verticalAlign: "middle" }}>●</span>
);

function Tag({ children, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, fontFamily: "'Azeret Mono', monospace",
      color, background: color + "14", padding: "3px 8px", borderRadius: 4,
      letterSpacing: "0.04em",
    }}>{children}</span>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? P.accDim : "transparent",
      border: active ? `1px solid ${P.accMid}` : "1px solid transparent",
      color: active ? P.acc : P.text3,
      fontSize: 11, fontWeight: 600, fontFamily: "'Azeret Mono', monospace",
      padding: "5px 12px", borderRadius: 5, cursor: "pointer",
      transition: "all 0.12s ease", letterSpacing: "0.02em",
    }}>{children}</button>
  );
}

function MonthTab({ active, disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: "transparent", border: "none",
      borderBottom: active ? `2px solid ${P.acc}` : "2px solid transparent",
      color: disabled ? P.text3 + "55" : active ? P.text : P.text3,
      fontSize: 12, fontWeight: active ? 700 : 500,
      fontFamily: "'Manrope', sans-serif",
      padding: "8px 14px 10px", cursor: disabled ? "default" : "pointer",
      transition: "all 0.12s", opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  );
}

/* ━━ Num display ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function Num({ label, value, sub, large }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 9, color: P.text3, marginBottom: 3,
        letterSpacing: "0.06em", textTransform: "uppercase",
        fontFamily: "'Azeret Mono', monospace",
      }}>{label}</div>
      <div style={{
        fontSize: large ? 22 : 16, fontWeight: 700, color: P.text,
        letterSpacing: "-0.03em", fontFamily: "'Manrope', sans-serif",
        fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: P.text3, marginTop: 2, fontFamily: "'Azeret Mono', monospace" }}>{sub}</div>}
    </div>
  );
}

/* ━━ Account card ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function AccountCard({ account, color, stats }) {
  const pct = stats.pct;
  const configured = account.configured !== false;
  return (
    <div style={{
      background: P.surface, borderRadius: 10, padding: "18px 20px",
      borderTop: `2px solid ${color}`, height: "100%", boxSizing: "border-box",
      opacity: configured ? 1 : 0.55,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: P.text, fontFamily: "'Manrope', sans-serif" }}>{account.name}</span>
          <div style={{ fontSize: 10, color: P.text3, marginTop: 1, fontFamily: "'Azeret Mono', monospace" }}>
            {account.plan}<Dot />{account.alias}
          </div>
        </div>
        {account.alias && <Tag color={color}>{account.alias}</Tag>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: stats.isLive ? P.green : P.text3,
          boxShadow: stats.isLive ? `0 0 6px ${P.green}88` : "none",
          animation: stats.isLive ? "pulse 2s ease infinite" : "none",
        }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: P.text2, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Azeret Mono', monospace" }}>
          {configured ? `5h block · ${stats.blockTime}` : "not configured"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <Num label="Tokens" value={stats.tokens} large />
        <Num label="Burn" value={stats.burn} sub="/hr" />
        <Num label="API $" value={stats.cost} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: P.text3, fontFamily: "'Azeret Mono', monospace" }}>
            {stats.used} / {stats.limit}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, fontFamily: "'Azeret Mono', monospace",
            color: pct > 95 ? P.red : pct > 80 ? P.amber : P.text2,
          }}>{pct}%</span>
        </div>
        <div style={{ height: 3, background: P.border, borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            width: `${Math.max(pct, 1)}%`, height: "100%", borderRadius: 2,
            background: pct > 90 ? P.red : pct > 70 ? P.amber : color,
            transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
          }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, paddingTop: 10, borderTop: `1px solid ${P.border}`, alignItems: "flex-end" }}>
        <Num label="Today" value={stats.today} sub={stats.todayCost} />
        <Num label="Month" value={stats.month} sub={stats.monthCost} />
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 9, color: P.text3, marginBottom: 3, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Azeret Mono', monospace" }}>Reset</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: P.text, fontFamily: "'Manrope', sans-serif", fontVariantNumeric: "tabular-nums" }}>{stats.reset}</div>
        </div>
      </div>
    </div>
  );
}

/* ━━ Chart tooltip ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function ChartTooltip({ active, payload, label, metric, isCumulative, accounts }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  const fmt = (v) => metric === "tokens" ? `${v.toFixed(2)}M` : `$${v.toFixed(2)}`;
  const nameFor = (dk) => {
    for (const a of accounts) if (dk.startsWith(a.id + "_")) return a.name;
    return dk;
  };
  return (
    <div style={{
      background: P.raised, border: `1px solid ${P.borderLt}`,
      borderRadius: 8, padding: "10px 14px", fontFamily: "'Azeret Mono', monospace",
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)", minWidth: 160,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: P.text, marginBottom: 8, fontFamily: "'Manrope', sans-serif" }}>
        Day {label}{isCumulative ? <span style={{ fontWeight: 400, color: P.text3 }}> · cumulative</span> : ""}
      </div>
      {payload.filter((p) => p.value > 0).map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: isCumulative ? "50%" : 2, background: p.stroke || p.fill || p.color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: P.text2, flex: 1 }}>{nameFor(p.dataKey)}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: P.text, fontVariantNumeric: "tabular-nums" }}>{fmt(p.value)}</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${P.border}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: P.text3 }}>Total</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: P.acc, fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</span>
      </div>
    </div>
  );
}

/* ━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function Dashboard() {
  const [apiData, setApiData] = useState(null);
  const [err, setErr] = useState(null);

  const now = new Date();
  const [year] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [mode, setMode] = useState("stacked");   // "stacked" (daily) | "cumulative"
  const [metric, setMetric] = useState("tokens"); // "tokens" | "cost"

  // ── Fetch loop ──
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) { setApiData(json); setErr(null); }
      } catch (e) {
        if (mounted) setErr(e.message || String(e));
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const accounts = apiData?.accounts || [];
  const sfx = metric === "tokens" ? "_tokens" : "_cost";

  const data = useMemo(
    () => accounts.length ? buildMonthData(accounts, year, month) : [],
    [accounts, year, month]
  );
  const cumData = useMemo(
    () => buildCumData(data, accounts, sfx),
    [data, accounts, sfx]
  );

  const allStats = useMemo(() => accounts.map(buildStats), [accounts]);
  const mTotals  = accounts.map((a) =>
    data.reduce((s, d) => s + (d[`${a.id}${sfx}`] || 0), 0)
  );
  const mTotal = mTotals.reduce((a, b) => a + b, 0);
  const fmt = (v) => metric === "tokens" ? `${v.toFixed(2)}M` : `$${v.toFixed(2)}`;

  const maxMonth = (year === now.getFullYear()) ? now.getMonth() : 11;

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const todayDay = isCurrentMonth ? now.getDate() : null;
  const todayLabel = todayDay ? String(todayDay) : null;

  const xTicks = useMemo(() => {
    if (!data.length) return [];
    const stride = Math.max(1, Math.floor(data.length / 16));
    const set = new Set();
    data.forEach((d, i) => { if (i % stride === 0) set.add(d.label); });
    set.add(data[data.length - 1].label);
    if (todayLabel) set.add(todayLabel);
    return Array.from(set);
  }, [data, todayLabel]);

  const DayTick = ({ x, y, payload }) => {
    const isToday = payload.value === todayLabel;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={12}
          textAnchor="middle"
          fill={isToday ? P.acc : P.text3}
          fontSize={10}
          fontWeight={isToday ? 700 : 400}
          fontFamily="'Azeret Mono', monospace"
        >
          {payload.value}
        </text>
      </g>
    );
  };

  const todayRefLine = todayLabel ? (
    <ReferenceLine
      x={todayLabel}
      stroke={P.acc}
      strokeDasharray="4 4"
      strokeOpacity={0.55}
      ifOverflow="extendDomain"
      label={{
        value: "Today",
        position: "top",
        fill: P.acc,
        fontSize: 10,
        fontFamily: "'Azeret Mono', monospace",
        fontWeight: 700,
      }}
    />
  ) : null;

  return (
    <div style={{
      minHeight: "100vh", background: P.bg, color: P.text,
      fontFamily: "'Manrope', sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ca { animation: fadeUp 0.4s cubic-bezier(0.4,0,0.2,1) both; }
        .grain::after {
          content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999;
          opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 200px;
        }
      `}</style>

      <div className="grain" style={{ padding: "24px 28px 48px" }}>

        {/* Header */}
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 22, animation: "fadeUp 0.35s cubic-bezier(0.4,0,0.2,1) both",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{
              fontSize: 14, fontWeight: 800, letterSpacing: "-0.03em", color: P.acc,
              fontFamily: "'Azeret Mono', monospace",
            }}>cc</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: P.text, letterSpacing: "-0.02em" }}>usage</span>
          </div>
          <div style={{ fontSize: 10, color: P.text3, fontFamily: "'Azeret Mono', monospace" }}>
            {now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            <Dot />{err ? <span style={{ color: P.red }}>backend offline</span> : fmtUpdated(apiData?.updated_at)}
          </div>
        </header>

        {/* Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, accounts.length)}, 1fr)`,
          gap: 12, marginBottom: 22,
        }}>
          {accounts.map((acc, i) => (
            <div key={acc.id} className="ca" style={{ animationDelay: `${i * 0.05}s` }}>
              <AccountCard account={acc} color={colorFor(acc, i)} stats={allStats[i]} />
            </div>
          ))}
          {!accounts.length && !err && (
            <div style={{ color: P.text3, fontSize: 13, padding: 20 }}>Loading…</div>
          )}
        </div>

        {/* Chart panel */}
        <div className="ca" style={{
          background: P.surface, borderRadius: 10,
          animation: "fadeUp 0.4s cubic-bezier(0.4,0,0.2,1) 0.15s both",
        }}>
          {/* Controls */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            borderBottom: `1px solid ${P.border}`, padding: "0 24px", flexWrap: "wrap",
            minHeight: 48,
          }}>
            <div style={{ display: "flex", gap: 0, overflow: "auto" }}>
              {MONTHS.map((m, i) => (
                <MonthTab
                  key={m}
                  active={month === i}
                  disabled={i > maxMonth}
                  onClick={() => i <= maxMonth && setMonth(i)}
                >
                  {m}
                </MonthTab>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 2, background: P.raised, borderRadius: 6, padding: 2 }}>
                <Chip active={metric === "tokens"} onClick={() => setMetric("tokens")}>Tokens</Chip>
                <Chip active={metric === "cost"}   onClick={() => setMetric("cost")}>Cost</Chip>
              </div>
              <div style={{ display: "flex", gap: 2, background: P.raised, borderRadius: 6, padding: 2 }}>
                <Chip active={mode === "stacked"}    onClick={() => setMode("stacked")}>Daily</Chip>
                <Chip active={mode === "cumulative"} onClick={() => setMode("cumulative")}>Cumulative</Chip>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{ padding: "20px 24px 16px" }}>
            <ResponsiveContainer width="100%" height={280}>
              {mode === "stacked" ? (
                <BarChart data={data} margin={{ top: 20, right: 0, left: -12, bottom: 0 }} barCategoryGap="16%">
                  <CartesianGrid stroke={P.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={<DayTick />} ticks={xTicks} axisLine={{ stroke: P.border }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: P.text3, fontFamily: "'Azeret Mono', monospace" }} axisLine={false} tickLine={false} tickFormatter={(v) => metric === "tokens" ? `${v}M` : `$${v}`} />
                  <Tooltip content={<ChartTooltip metric={metric} accounts={accounts} />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                  {todayRefLine}
                  {accounts.map((a, i) => {
                    const isTop = i === accounts.length - 1;
                    return (
                      <Bar
                        key={a.id}
                        dataKey={`${a.id}${sfx}`}
                        stackId="s"
                        fillOpacity={0.9}
                        radius={isTop ? [2, 2, 0, 0] : 0}
                      >
                        {data.map((e, j) => {
                          const markToday = isTop && e.day === todayDay;
                          return (
                            <Cell
                              key={j}
                              fill={e.future ? P.border : colorFor(a, i)}
                              fillOpacity={e.future ? 0.2 : 0.85 - i * 0.05}
                              stroke={markToday ? P.acc : undefined}
                              strokeWidth={markToday ? 1.25 : 0}
                            />
                          );
                        })}
                      </Bar>
                    );
                  })}
                </BarChart>
              ) : (
                <AreaChart data={cumData} margin={{ top: 20, right: 0, left: -12, bottom: 0 }}>
                  <defs>
                    {accounts.map((a, i) => {
                      const c = colorFor(a, i);
                      return (
                        <linearGradient key={a.id} id={`grad_${a.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={c} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid stroke={P.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={<DayTick />} ticks={xTicks} axisLine={{ stroke: P.border }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: P.text3, fontFamily: "'Azeret Mono', monospace" }} axisLine={false} tickLine={false} tickFormatter={(v) => metric === "tokens" ? `${v}M` : `$${v}`} />
                  <Tooltip content={<ChartTooltip metric={metric} isCumulative accounts={accounts} />} cursor={{ stroke: P.text3, strokeDasharray: "3 3" }} />
                  {todayRefLine}
                  {accounts.map((a, i) => {
                    const c = colorFor(a, i);
                    return (
                      <Area
                        key={a.id}
                        type="monotone"
                        dataKey={`${a.id}${sfx}_cum`}
                        stackId="cum"
                        stroke={c}
                        strokeWidth={2}
                        fill={`url(#grad_${a.id})`}
                        fillOpacity={1}
                        dot={false}
                        activeDot={{ r: 4, fill: c, stroke: P.bg, strokeWidth: 2 }}
                      />
                    );
                  })}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Summary strip */}
          <div style={{
            display: "flex", gap: 0, borderTop: `1px solid ${P.border}`,
            fontFamily: "'Azeret Mono', monospace",
          }}>
            {[
              ...accounts.map((a, i) => ({ label: a.name, value: fmt(mTotals[i]), color: colorFor(a, i) })),
              { label: "Combined", value: fmt(mTotal), color: null },
            ].map((item, i, arr) => (
              <div key={i} style={{
                flex: 1, padding: "12px 18px",
                borderRight: i < arr.length - 1 ? `1px solid ${P.border}` : "none",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {item.color ? (
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                ) : (
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: `linear-gradient(135deg, ${P.a1}, ${P.a2}, ${P.a3})`,
                  }} />
                )}
                <span style={{ fontSize: 10, color: P.text3 }}>{item.label}</span>
                <span style={{
                  fontSize: 12, fontWeight: 700, color: P.text, marginLeft: "auto",
                  fontVariantNumeric: "tabular-nums",
                }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
