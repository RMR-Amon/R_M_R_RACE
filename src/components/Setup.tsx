import { useState } from 'react';
import { Choice, CoinBadge, ScreenShell, TopBar, TrackThumb } from './ui';
import { ARENA_MAP, RACE_MAPS, THEMES, mapDesc, mapName, themeName } from '../data/maps';
import { getCar } from '../data/cars';
import { t, useLang } from '../i18n';
import type { SaveData } from '../store/save';
import type { Difficulty, RaceConfig, ThemeId } from '../game/types';

/** what the player chooses here; App adds car paint, driver and settings */
export type RaceSetup = Pick<RaceConfig, 'mapId' | 'theme' | 'mode' | 'difficulty' | 'opponents' | 'items'>;

interface Props {
  save: SaveData;
  onBack: () => void;
  onGarage: () => void;
  onDifficulty: (d: Difficulty) => void;
  onStart: (cfg: RaceSetup) => void;
}

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'impossible'];
const DIFF_STYLE: Record<Difficulty, string> = {
  easy: 'from-emerald-400/30 to-teal-600/30 ring-emerald-300',
  medium: 'from-sky-400/30 to-indigo-600/30 ring-sky-300',
  hard: 'from-orange-400/30 to-rose-600/30 ring-orange-300',
  impossible: 'from-fuchsia-500/40 to-black ring-fuchsia-400',
};
const DIFF_ICON: Record<Difficulty, string> = { easy: '🙂', medium: '😎', hard: '😤', impossible: '😈' };

export default function Setup({ save, onBack, onGarage, onDifficulty, onStart }: Props) {
  useLang();
  const [mode, setMode] = useState<'race' | 'battle'>('race');
  const [mapId, setMapId] = useState(RACE_MAPS[0].id);
  const [laps, setLaps] = useState(3);
  const [arenaTheme, setArenaTheme] = useState<ThemeId>('city');
  const [minutes, setMinutes] = useState(3);
  const [opponents, setOpponents] = useState(5);
  const [items, setItems] = useState(true);
  const difficulty = save.difficulty;
  const car = getCar(save.selectedCar);
  const paint = save.paints[car.id];

  const start = () => {
    const common = { difficulty, opponents, items: mode === 'battle' ? true : items };
    if (mode === 'race') {
      const m = RACE_MAPS.find((x) => x.id === mapId)!;
      onStart({ mapId, theme: m.theme, mode: { kind: 'race', laps }, ...common });
    } else {
      onStart({ mapId: 'arena', theme: arenaTheme, mode: { kind: 'battle', duration: minutes * 60 }, ...common });
    }
  };

  return (
    <ScreenShell>
      <TopBar title={t('setup.title')} onBack={onBack} right={<CoinBadge coins={save.coins} />} />
      <div className="mx-auto max-w-7xl space-y-6 px-4 pb-32 sm:px-8">
        {/* mode */}
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['race', t('mode.race'), t('mode.raceSub')],
              ['battle', t('mode.battle'), t('mode.battleSub')],
            ] as const
          ).map(([id, title, sub]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`rounded-2xl p-3 text-left ring-2 transition sm:p-5 ${
                mode === id ? 'bg-gradient-to-br from-pink-500/30 to-violet-600/30 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
              }`}
            >
              <div className="font-display text-xl sm:text-2xl">{title}</div>
              <div className="text-xs text-white/60 sm:text-sm">{sub}</div>
            </button>
          ))}
        </div>

        {/* difficulty */}
        <section>
          <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.difficulty')}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {DIFFS.map((d) => (
              <button
                key={d}
                onClick={() => onDifficulty(d)}
                className={`rounded-2xl bg-gradient-to-br p-3 text-left ring-2 transition sm:p-4 ${
                  difficulty === d ? DIFF_STYLE[d] : 'from-white/5 to-white/5 ring-white/10 hover:from-white/10 hover:to-white/10'
                }`}
              >
                <div className="flex items-center gap-2 font-display text-lg">
                  <span className="text-2xl">{DIFF_ICON[d]}</span>
                  {t(`diff.${d}`)}
                </div>
                <div className="mt-1 text-xs text-white/65">{t(`diff.${d}Hint`)}</div>
              </button>
            ))}
          </div>
        </section>

        {mode === 'race' ? (
          <>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.track')}</h2>
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
                      <div className={`relative h-28 sm:h-36 bg-gradient-to-br ${th.gradient}`}>
                        <TrackThumb map={m} className="absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] opacity-90" />
                        <span className="absolute left-3 top-2 text-3xl drop-shadow">{th.emoji}</span>
                        {active && (
                          <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-black text-black">✓</span>
                        )}
                      </div>
                      <div className="bg-black/40 p-3">
                        <div className="font-display text-base">{mapName(m)}</div>
                        <div className="text-xs font-bold uppercase tracking-wider" style={{ color: th.accent }}>
                          {themeName(m.theme)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-white/60">{mapDesc(m)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="grid gap-6 lg:grid-cols-3">
              <section>
                <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.laps')}</h2>
                <Choice value={laps} onPick={setLaps} options={[1, 2, 3, 4, 5].map((n) => ({ id: n, label: n }))} />
              </section>
              <section>
                <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.opponents')}</h2>
                <Choice value={opponents} onPick={setOpponents} options={[1, 3, 5, 7].map((n) => ({ id: n, label: n }))} />
              </section>
              <section>
                <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.items')}</h2>
                <Choice
                  value={items ? 'on' : 'off'}
                  onPick={(v) => setItems(v === 'on')}
                  options={[
                    { id: 'on', label: `📦 ${t('common.on')}` },
                    { id: 'off', label: t('common.off') },
                  ]}
                />
              </section>
            </div>
          </>
        ) : (
          <>
            <section className="panel grid gap-4 p-4 sm:grid-cols-[260px_1fr] sm:p-6">
              <div className={`relative h-40 rounded-2xl bg-gradient-to-br ${THEMES[arenaTheme].gradient}`}>
                <TrackThumb map={ARENA_MAP} className="absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)]" />
              </div>
              <div>
                <h3 className="font-display text-2xl">{mapName(ARENA_MAP)}</h3>
                <p className="mt-1 text-white/70">{mapDesc(ARENA_MAP)}</p>
                <ul className="mt-3 space-y-1 text-sm text-white/60">
                  <li>{t('setup.rule1')}</li>
                  <li>{t('setup.rule2')}</li>
                  <li>{t('setup.rule3')}</li>
                </ul>
              </div>
            </section>
            <section>
              <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.arenaTheme')}</h2>
              <div className="flex flex-wrap gap-3">
                {Object.values(THEMES).map((th) => (
                  <button
                    key={th.id}
                    onClick={() => setArenaTheme(th.id)}
                    className={`flex items-center gap-2 rounded-2xl bg-gradient-to-br px-4 py-3 font-bold ring-4 transition ${th.gradient} ${
                      arenaTheme === th.id ? 'ring-white' : 'ring-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <span className="text-2xl">{th.emoji}</span>
                    <span className="text-outline">{themeName(th.id)}</span>
                  </button>
                ))}
              </div>
            </section>
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <section>
                <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">
                  {t('setup.duration')}: <span className="text-amber-300">{t('setup.min', { n: minutes })}</span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setMinutes(n)}
                      className={`h-10 w-10 rounded-xl font-display text-lg ring-2 transition sm:h-12 sm:w-12 sm:rounded-2xl sm:text-xl ${
                        minutes === n ? 'bg-gradient-to-b from-orange-400 to-rose-600 ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="mb-3 font-display text-lg uppercase tracking-wider text-white/80">{t('setup.opponents')}</h2>
                <Choice value={opponents} onPick={setOpponents} options={[1, 3, 5, 7].map((n) => ({ id: n, label: n }))} />
              </section>
            </div>
          </>
        )}
      </div>

      {/* sticky start bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b0820]/85 px-4 py-3 backdrop-blur-md sm:px-8 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <button onClick={onGarage} className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/5 px-3 py-2 ring-1 ring-white/10 hover:bg-white/10">
            <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${paint?.color ?? car.color}, ${paint?.accent ?? car.accent})` }} />
            <span className="min-w-0 text-left">
              <span className="block text-[10px] uppercase tracking-widest text-white/50">{t('setup.car')}</span>
              <span className="block truncate font-display text-sm">{car.name}</span>
            </span>
          </button>
          <button onClick={start} className="btn-primary text-base sm:!px-8 sm:text-xl">
            {t('setup.start')}
          </button>
        </div>
      </div>
    </ScreenShell>
  );
}
