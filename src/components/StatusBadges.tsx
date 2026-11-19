import React from 'react';

export function StatusPill({ status }: { status: string }) {
  const norm = status.toUpperCase();
  if (norm === 'UP' || norm === 'OPERATIONAL' || norm === 'RESOLVED' || norm === 'COMPLETED' || norm === 'SENT') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#00a572]/20 border border-[#4edea3]/40 text-[#4edea3] font-mono text-[11px] font-medium whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
        {norm === 'UP' ? 'Operational' : status}
      </span>
    );
  }
  if (norm === 'DEGRADED' || norm === 'IDENTIFIED' || norm === 'MONITORING' || norm === 'UPCOMING') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 font-mono text-[11px] font-medium whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        {norm === 'DEGRADED' ? 'Degraded' : status}
      </span>
    );
  }
  if (norm === 'DOWN' || norm === 'INVESTIGATING' || norm === 'CRITICAL' || norm === 'FAILED' || norm === 'OUTAGE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#93000a]/50 border border-[#ff5451]/60 text-[#ffb4ab] font-mono text-[11px] font-medium whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-[#ff5451] animate-ping" />
        {norm === 'DOWN' ? 'Down' : status}
      </span>
    );
  }
  if (norm === 'MAINTENANCE' || norm === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#4d8eff]/20 border border-[#adc6ff]/40 text-[#adc6ff] font-mono text-[11px] font-medium whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-[#adc6ff]" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#1b2b3f] border border-[#424754] text-[#c2c6d6] font-mono text-[11px] font-medium whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-[#8c909f]" />
      {norm === 'PAUSED' ? 'Paused' : status}
    </span>
  );
}

export function ProtocolBadge({ protocol }: { protocol: string }) {
  const p = protocol.toUpperCase();
  const tone =
    p === 'HTTPS' || p === 'HTTP'
      ? 'bg-[#4d8eff]/15 text-[#adc6ff] border-[#4d8eff]/30'
      : p === 'TCP'
        ? 'bg-[#00a572]/15 text-[#4edea3] border-[#4edea3]/30'
        : p === 'DNS'
          ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
          : 'bg-purple-500/15 text-purple-300 border-purple-400/30';

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold tracking-wider uppercase ${tone}`}>
      {p}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toUpperCase();
  const cls =
    s === 'CRITICAL'
      ? 'bg-[#93000a]/60 text-[#ffb4ab] border-[#ff5451]/50'
      : s === 'HIGH'
        ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
        : s === 'MEDIUM'
          ? 'bg-[#4d8eff]/20 text-[#adc6ff] border-[#4d8eff]/40'
          : 'bg-[#1b2b3f] text-[#c2c6d6] border-[#424754]';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] font-semibold uppercase ${cls}`}>
      {s}
    </span>
  );
}
