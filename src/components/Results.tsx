import { useEffect, useState } from 'react';
import { CoinBadge, ScreenShell } from './ui';
import type { RaceResult } from '../game/types';

interface Props {
  result: RaceResult;
  totalCoins: number;
  onAgain: () => void;
  onMenu: () => void;
  onGarage: () => void;
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};

const MEDAL = ['🥇', '🥈', '🥉'];

export default function Results({ result, totalCoins, onAgain, onMenu, onGarage }: Props) {
  const battle = result.mode.kind === 'battle';
  const [shown, setShown] = useState(0);

  // count-up animation for the coin reward
  useEffect(() => {
    const target = result.playerCoins;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 1400);
      setShown(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.playerCoins]);

  const place = result.playerPlace;
  const title = place === 1 ? 'ПОБЕДА!' : place <= 3 ? 'На подиуме!' : 'Финиш!';

  return (
    <ScreenShell>
      <div className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col items-center px-4 py-8 sm:px-8">
        <div className="flex w-full justify-end">
          <CoinBadge coins={totalCoins} />
        </div>
        <div className="mt-2 animate-pop text-7xl sm:text-8xl">{MEDAL[place - 1] ?? '🏁'}</div>
        <h1 className="mt-2 animate-slideUp bg-gradient-to-b from-yellow-200 to-orange-500 bg-clip-text text-center font-display text-5xl text-transparent sm:text-7xl">
          {title}
        </h1>
        <p className="mt-1 text-white/60">
          {result.mapName} · {battle ? 'Битва' : `${result.mode.kind === 'race' ? result.mode.laps : 0} кр.`} · {place} место
        </p>

        <div className="panel mt-6 flex w-full animate-slideUp flex-col items-center gap-1 bg-gradient-to-br from-amber-400/20 to-orange-600/10 p-6">
          <span className="text-sm font-bold uppercase tracking-[0.3em] text-amber-200/80">Награда</span>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 animate-floaty place-items-center rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 text-2xl font-black text-amber-900 shadow-[0_0_30px_rgba(251,191,36,.7)]">
              $
            </span>
            <span className="font-display text-6xl tabular-nums text-amber-200">+{shown}</span>
          </div>
          <span className="text-xs text-white/50">монеты можно потратить в гараже на новые машины</span>
        </div>

        <div className="panel mt-6 w-full overflow-hidden">
          <div className="grid grid-cols-[2.5rem_1fr_auto_auto] gap-x-3 border-b border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
            <span>#</span>
            <span>Гонщик</span>
            <span className="text-right">{battle ? 'Очки' : 'Время'}</span>
            <span className="w-16 text-right">Монеты</span>
          </div>
          {result.rows.map((r, i) => (
            <div
              key={r.name + i}
              style={{ animationDelay: `${200 + i * 90}ms` }}
              className={`grid animate-slideUp grid-cols-[2.5rem_1fr_auto_auto] items-center gap-x-3 px-4 py-2.5 ${
                r.isPlayer ? 'bg-white/15' : i % 2 ? 'bg-white/[0.03]' : ''
              }`}
            >
              <span className="font-display text-xl">{MEDAL[r.place - 1] ?? r.place}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="min-w-0">
                  <span className={`block truncate ${r.isPlayer ? 'font-black' : 'font-bold'}`}>{r.name}</span>
                  <span className="block truncate text-xs text-white/50">
                    {r.carName} · 🎯 {r.hits}
                  </span>
                </span>
              </span>
              <span className="text-right font-mono text-sm">
                {battle ? <b className="font-display text-lg text-amber-300">{r.points}</b> : r.time !== null ? fmt(r.time) : 'DNF'}
              </span>
              <span className="w-16 text-right font-bold text-amber-200">+{r.coins}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
          <button onClick={onAgain} className="btn-primary">↻ Ещё раз</button>
          <button onClick={onGarage} className="btn-ghost">🚗 Гараж</button>
          <button onClick={onMenu} className="btn-ghost">⌂ Меню</button>
        </div>
      </div>
    </ScreenShell>
  );
}
