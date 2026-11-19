import React, { useState } from 'react';

export interface LatencyPoint {
  label: string;
  valueMs: number;
  availabilityPct?: number;
}

export function LatencyTrendChart({
  points,
  height = 210,
  p50Ms,
  p95Ms,
  accentColor = '#adc6ff',
}: {
  points: LatencyPoint[];
  height?: number;
  p50Ms?: number;
  p95Ms?: number;
  accentColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!points || points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl bg-[#000f21]/60 border border-[#1b2b3f] text-xs font-mono text-[#8c909f]"
        style={{ height }}
      >
        No telemetry check points recorded in this range.
      </div>
    );
  }

  const width = 760;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const vals = points.map((p) => p.valueMs);
  const rawMax = Math.max(...vals, p95Ms || 0, 20);
  const maxY = Math.ceil((rawMax * 1.15) / 10) * 10 || 100;

  const getX = (i: number) => (points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW);
  const getY = (v: number) => padT + plotH - (Math.max(0, v) / maxY) * plotH;

  const pathD = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(pt.valueMs).toFixed(1)}`)
    .join(' ');
  const areaD = `${pathD} L ${getX(points.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const yTicks = [0, Math.round(maxY / 2), maxY];
  const activePt = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
        <defs>
          <linearGradient id="vnLatencyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = getY(tick);
          return (
            <g key={tick}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#1b2b3f" strokeDasharray="3 3" />
              <text x={padL - 8} y={y + 3} textAnchor="end" className="fill-[#8c909f] font-mono text-[10px]">
                {tick}ms
              </text>
            </g>
          );
        })}

        {p95Ms !== undefined && p95Ms > 0 && p95Ms <= maxY && (
          <g>
            <line
              x1={padL}
              y1={getY(p95Ms)}
              x2={width - padR}
              y2={getY(p95Ms)}
              stroke="#ffb3ad"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.7"
            />
            <text x={width - padR - 4} y={getY(p95Ms) - 4} textAnchor="end" className="fill-[#ffb3ad] font-mono text-[9px]">
              P95 {p95Ms}ms
            </text>
          </g>
        )}

        {p50Ms !== undefined && p50Ms > 0 && p50Ms <= maxY && (
          <line
            x1={padL}
            y1={getY(p50Ms)}
            x2={width - padR}
            y2={getY(p50Ms)}
            stroke="#4edea3"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.7"
          />
        )}

        <path d={areaD} fill="url(#vnLatencyGrad)" />
        <path d={pathD} fill="none" stroke={accentColor} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((pt, idx) => {
          const cx = getX(idx);
          const cy = getY(pt.valueMs);
          const isHovered = hoverIdx === idx;
          return (
            <g key={idx}>
              <rect
                x={cx - plotW / Math.max(points.length * 2, 16)}
                y={padT}
                width={Math.max(12, plotW / Math.max(points.length, 1))}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="cursor-crosshair"
              />
              {(isHovered || points.length <= 24) && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 4.5 : 2.2}
                  fill={isHovered ? '#4edea3' : accentColor}
                  stroke="#031427"
                  strokeWidth="1.5"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* X Axis sparse labels */}
        {[0, Math.floor(points.length / 2), points.length - 1]
          .filter((v, i, arr) => v >= 0 && v < points.length && arr.indexOf(v) === i)
          .map((idx) => (
            <text
              key={idx}
              x={getX(idx)}
              y={height - 6}
              textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
              className="fill-[#8c909f] font-mono text-[10px]"
            >
              {points[idx].label}
            </text>
          ))}
      </svg>

      {activePt && hoverIdx !== null && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#000f21] border border-[#26364a] font-mono text-[11px]">
          <span className="text-[#c2c6d6]">{activePt.label}</span>
          <div className="flex items-center gap-3">
            <span className="text-[#adc6ff]">
              Latency: <strong className="text-[#d3e4fe] tabular-nums">{activePt.valueMs}ms</strong>
            </span>
            {activePt.availabilityPct !== undefined && (
              <span className="text-[#4edea3]">
                Availability: <strong className="tabular-nums">{activePt.availabilityPct}%</strong>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function HeartbeatBarStrip({
  bars,
  slots = 45,
}: {
  bars: Array<{ day: string; uptime_pct: number; status?: string }>;
  slots?: number;
}) {
  const [selected, setSelected] = useState<{ day: string; uptime_pct: number } | null>(null);
  const sliced = bars.slice(-slots);

  if (sliced.length === 0) {
    return <div className="h-6 rounded bg-[#102034] border border-[#1b2b3f]" />;
  }

  return (
    <div>
      <div className="flex items-center gap-[2px] h-7">
        {sliced.map((bar, idx) => {
          const color =
            bar.uptime_pct >= 99.5
              ? 'bg-[#4edea3]'
              : bar.uptime_pct >= 95
                ? 'bg-amber-400'
                : 'bg-[#ff5451]';
          return (
            <button
              key={`${bar.day}-${idx}`}
              type="button"
              onMouseEnter={() => setSelected(bar)}
              onFocus={() => setSelected(bar)}
              onMouseLeave={() => setSelected(null)}
              title={`${bar.day}: ${bar.uptime_pct}% uptime`}
              className={`flex-1 h-full rounded-[2px] ${color} opacity-85 hover:opacity-100 hover:scale-y-110 transition-all`}
              aria-label={`${bar.day} uptime ${bar.uptime_pct}%`}
            />
          );
        })}
      </div>
      {selected && (
        <div className="mt-1 font-mono text-[10px] text-[#c2c6d6] flex items-center justify-between">
          <span>{selected.day}</span>
          <span className="text-[#4edea3] tabular-nums">{selected.uptime_pct}% uptime</span>
        </div>
      )}
    </div>
  );
}

export function MiniSparkline({ checks }: { checks: Array<{ status: string; response_time_ms: number }> }) {
  if (!checks || checks.length === 0) {
    return <span className="font-mono text-[10px] text-[#8c909f]">—</span>;
  }
  const sliced = checks.slice(-18);
  const maxMs = Math.max(...sliced.map((c) => c.response_time_ms), 20);
  return (
    <div className="flex items-end gap-[2px] h-5 w-24">
      {sliced.map((c, idx) => {
        const hPct = Math.max(20, Math.min(100, Math.round((c.response_time_ms / maxMs) * 100)));
        const cls = c.status === 'UP' ? 'bg-[#4edea3]' : c.status === 'DEGRADED' ? 'bg-amber-400' : 'bg-[#ff5451]';
        return (
          <span
            key={idx}
            style={{ height: `${hPct}%` }}
            className={`flex-1 rounded-[1px] ${cls} opacity-85`}
            title={`${c.status} • ${c.response_time_ms}ms`}
          />
        );
      })}
    </div>
  );
}
