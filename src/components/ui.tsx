import type { ReactNode } from 'react';
import type { MapDef } from '../data/maps';
import { fmtNum, t } from '../i18n';

export function CoinBadge({ coins, className = '' }: { coins: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-full bg-black/40 py-1.5 pl-1.5 pr-4 ring-1 ring-amber-300/40 ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 text-sm font-black text-amber-900 shadow-inner">
        $
      </span>
      <span className="font-display text-lg tabular-nums text-amber-200">{fmtNum(coins)}</span>
    </div>
  );
}

export function StatBar({ label, value, color = 'from-cyan-400 to-blue-500' }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-wider text-white/60">{label}</span>
      <div className="flex h-2.5 flex-1 gap-[3px]">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`h-full flex-1 rounded-sm ${i < value ? `bg-gradient-to-r ${color}` : 'bg-white/10'}`} />
        ))}
      </div>
      <span className="w-5 text-right font-display text-sm text-white/80">{value}</span>
    </div>
  );
}

export function ScreenShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative h-full w-full overflow-y-auto overflow-x-hidden scrollbar-thin bg-[#0b0820] ${className}`}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,.35),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(244,63,94,.25),transparent_55%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative">{children}</div>
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#0b0820]/70 px-4 py-3 backdrop-blur-md sm:px-8">
      <button onClick={onBack} className="btn-ghost shrink-0 !px-4 !py-2 text-sm">
        ←<span className="hidden sm:inline"> {t('common.back')}</span>
      </button>
      <h1 className="truncate font-display text-lg uppercase tracking-wider sm:text-3xl">{title}</h1>
      <div className="flex shrink-0 justify-end">{right}</div>
    </div>
  );
}

/** SVG outline of a track for map cards */
/** Row of round colour buttons */
export function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          aria-label={c}
          className={`h-8 w-8 rounded-full ring-2 transition sm:h-9 sm:w-9 ${value.toLowerCase() === c.toLowerCase() ? 'scale-110 ring-white' : 'ring-white/15 hover:ring-white/50'}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/** Pill-style option buttons (single choice) */
export function Choice<T extends string | number>({
  options,
  value,
  onPick,
  className = '',
}: {
  options: { id: T; label: ReactNode; sub?: ReactNode }[];
  value: T;
  onPick: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2.5 ${className}`}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onPick(o.id)}
          className={`rounded-2xl px-4 py-2.5 text-left ring-2 transition ${
            value === o.id ? 'bg-gradient-to-b from-orange-400 to-rose-600 ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10'
          }`}
        >
          <div className="font-display text-base">{o.label}</div>
          {o.sub && <div className="max-w-[16rem] text-xs text-white/70">{o.sub}</div>}
        </button>
      ))}
    </div>
  );
}

export function TrackThumb({ map, className = '' }: { map: MapDef; className?: string }) {
  if (map.oval) {
    const { a, b } = map.oval;
    return (
      <svg viewBox={`${-a - 30} ${-b - 30} ${a * 2 + 60} ${b * 2 + 60}`} className={className} preserveAspectRatio="xMidYMid meet">
        <ellipse cx={0} cy={0} rx={a + 8} ry={b + 8} fill="rgba(0,0,0,.45)" />
        <ellipse cx={0} cy={0} rx={a} ry={b} fill="white" />
        <ellipse cx={0} cy={0} rx={a * 0.55} ry={b * 0.55} fill="none" stroke="rgba(0,0,0,.3)" strokeWidth={4} strokeDasharray="14 14" />
        <circle cx={0} cy={0} r={16} fill="#facc15" stroke="#111" strokeWidth={5} />
      </svg>
    );
  }
  const xs = map.points.map((p) => p[0]);
  const zs = map.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const pad = 60;
  const vb = `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`;
  // smooth closed path through the control points (Catmull-Rom → Bézier)
  const pts = map.points;
  const n = pts.length;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return (
    <svg viewBox={vb} className={className} preserveAspectRatio="xMidYMid meet">
      <path d={d} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={map.width * 1.6} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="white" strokeWidth={map.width * 0.9} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={4} strokeDasharray="18 18" />
      <circle cx={pts[0][0]} cy={pts[0][1]} r={map.width * 0.8} fill="#facc15" stroke="#111" strokeWidth={6} />
    </svg>
  );
}
