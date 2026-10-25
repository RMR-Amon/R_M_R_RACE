import { useState } from 'react';
import { CoinBadge, ScreenShell, TopBar, TrackThumb } from './ui';
import { ARENA_MAP, RACE_MAPS, THEMES } from '../data/maps';
import { getCar } from '../data/cars';
import type { SaveData } from '../store/save';
import type { RaceConfig, ThemeId } from '../game/types';

interface Props {
  save: SaveData;
  onBack: () => void;
  onGarage: () => void;
  onStart: (cfg: RaceConfig) => void;
}

export default function Setup({ save, onBack, onGarage, onStart }: Props) {
  const [mode, setMode] = useState<'race' | 'battle'>('race');
  const [mapId, setMapId] = useState(RACE_MAPS[0].id);
  const [laps, setLaps] = useState(3);
  const [arenaTheme, setArenaTheme] = useState<ThemeId>('city');
  const [duration, setDuration] = useState(120);
  const car = getCar(save.selectedCar);

  const start = () => {
    if (mode === 'race') {
      const m = RACE_MAPS.find((x) => x.id === mapId)!;
      onStart({ mapId, theme: m.theme, mode: { kind: 'race', laps }, carId: car.id });
    } else {
      onStart({ mapId: 'arena', theme: arenaTheme, mode: { kind: 'battle', duration }, carId: car.id });
    }
  };

  return (
    <ScreenShell>
      <TopBar title="Новая гонка" onBack={onBack} right={<CoinBadge coins={save.coins} />} />
      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-32 sm:px-8">
        {/* mode */}
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['race', '🏁 Гонка', 'Обгони всех и приди первым'],
              ['battle', '⚔️ Битва', 'Попадай во врагов — получай очки'],
            ] as const
          ).map(([id, title, sub]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`rounded-2xl p-4 text-left ring-2 transition sm:p-5 ${
                mode === id ? 'bg-gradient-to-br from-pink-500/30 to-violet-600/30 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
              }`}
            >
              <div className="font-display text-xl sm:text-2xl">{title}</div>
              <div className="text-xs text-white/60 sm:text-sm">{sub}</div>
            </button>
          ))}
        </div>

        {mode === 'race' ? (
          <>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">Трасса</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {RACE_MAPS.map((m, i) => {
                  const th = THEMES[m.theme];
                  const active = m.id === mapId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMapId(m.id)}
                      style={{ animationDelay: `${i * 50}ms` }}
                      className={`group animate-slideUp overflow-hidden rounded-3xl text-left ring-4 transition ${
                        active ? 'scale-[1.02] ring-white' : 'ring-transparent hover:ring-white/30'
                      }`}
                    >
                      <div className={`relative h-36 bg-gradient-to-br ${th.gradient}`}>
                        <TrackThumb map={m} className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] opacity-90" />
                        <span className="absolute left-3 top-2 text-3xl drop-shadow">{th.emoji}</span>
                        {active && (
                          <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-black text-black">
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="bg-black/40 p-3">
                        <div className="font-display text-base">{m.name}</div>
                        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: th.accent }}>
                          {th.name}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-white/60">{m.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">Количество кругов</h2>
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setLaps(n)}
                    className={`h-14 w-14 rounded-2xl font-display text-2xl ring-2 transition sm:h-16 sm:w-16 ${
                      laps === n ? 'bg-gradient-to-b from-orange-400 to-rose-600 ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="panel grid gap-4 p-4 sm:grid-cols-[220px_1fr] sm:p-6">
              <div className={`relative h-40 rounded-2xl bg-gradient-to-br ${THEMES[arenaTheme].gradient}`}>
                <TrackThumb map={ARENA_MAP} className="absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)]" />
              </div>
              <div>
                <h3 className="font-display text-2xl">{ARENA_MAP.name}</h3>
                <p className="mt-1 text-white/70">{ARENA_MAP.description}</p>
                <ul className="mt-3 space-y-1 text-sm text-white/60">
                  <li>🎯 +1 очко за каждое попадание ракетой, бомбой, маслом или льдом</li>
                  <li>📦 Лаки-блоки появляются чаще</li>
                  <li>🪙 Монеты за очки и место</li>
                </ul>
              </div>
            </section>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">Оформление арены</h2>
              <div className="flex flex-wrap gap-3">
                {Object.values(THEMES).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setArenaTheme(t.id)}
                    className={`flex items-center gap-2 rounded-2xl bg-gradient-to-br px-4 py-3 font-bold ring-4 transition ${t.gradient} ${
                      arenaTheme === t.id ? 'ring-white' : 'ring-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <span className="text-2xl">{t.emoji}</span>
                    <span className="text-outline">{t.name}</span>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">Длительность</h2>
              <div className="flex flex-wrap gap-3">
                {[60, 120, 180].map((s) => (
                  <button
                    key={s}
                    onClick={() => setDuration(s)}
                    className={`rounded-2xl px-5 py-3 font-display text-lg ring-2 transition ${
                      duration === s ? 'bg-gradient-to-b from-orange-400 to-rose-600 ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {s / 60} мин
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* sticky start bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b0820]/85 px-4 py-3 backdrop-blur-md sm:px-8 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <button onClick={onGarage} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/5 px-3 py-2 ring-1 ring-white/10 hover:bg-white/10">
            <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${car.color}, ${car.accent})` }} />
            <span className="min-w-0 text-left">
              <span className="block text-[10px] uppercase tracking-widest text-white/50">Машина</span>
              <span className="block truncate font-display text-sm">{car.name}</span>
            </span>
          </button>
          <button onClick={start} className="btn-primary !px-8 text-xl">
            Старт 🏁
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
