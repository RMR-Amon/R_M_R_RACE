import { useState } from 'react';
import CarPreview from './CarPreview';
import { CoinBadge, ScreenShell, StatBar, Swatches, TopBar } from './ui';
import { CARS, carDesc, carParams, getCar, massKg, paintedCar, zeroTo100 } from '../data/cars';
import { ACCESSORIES, HAIR_COLORS, HELMET_COLORS, PAINT_COLORS, SKIN_TONES, SUIT_COLORS, VISOR_COLORS, accessorySlot } from '../data/cosmetics';
import { fmtNum, t, useLang, type TKey } from '../i18n';
import type { SaveData } from '../store/save';
import type { Accessory, DriverLook } from '../game/types';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  onBack: () => void;
}

type Tab = 'cars' | 'paint' | 'driver';

const BODY_ICON: Record<string, string> = { f1: '🏎️', kart: '🛞', van: '🚐', suv: '🚙', buggy: '🏜️' };

export default function Garage({ save, update, onBack }: Props) {
  useLang();
  const [tab, setTab] = useState<Tab>('cars');
  const [viewId, setViewId] = useState(save.selectedCar);
  const [helmet, setHelmet] = useState(false);
  const base = getCar(viewId);
  const car = paintedCar(base, save.paints[base.id]);
  const owned = save.owned.includes(base.id);
  const selected = save.selectedCar === base.id;
  const canBuy = save.coins >= base.price;
  const p = carParams(base);

  const buy = () => {
    if (owned || !canBuy) return;
    update((s) => ({ ...s, coins: s.coins - base.price, owned: [...s.owned, base.id], selectedCar: base.id }));
  };
  const select = () => update((s) => ({ ...s, selectedCar: base.id }));
  const setPaint = (key: 'color' | 'accent', c: string) =>
    update((s) => ({ ...s, paints: { ...s.paints, [base.id]: { color: car.color, accent: car.accent, [key]: c } } }));
  const resetPaint = () =>
    update((s) => {
      const paints = { ...s.paints };
      delete paints[base.id];
      return { ...s, paints };
    });
  const setLook = (patch: Partial<DriverLook>) => update((s) => ({ ...s, driver: { ...s.driver, ...patch } }));

  const toggleAccessory = (a: Accessory, price: number) => {
    update((s) => {
      const wearing = s.driver.accessories.includes(a);
      if (!s.ownedAccessories.includes(a)) {
        if (s.coins < price) return s;
        // buying puts it straight on
        const accessories = [...s.driver.accessories.filter((x) => accessorySlot(x) !== accessorySlot(a)), a];
        return { ...s, coins: s.coins - price, ownedAccessories: [...s.ownedAccessories, a], driver: { ...s.driver, accessories } };
      }
      const accessories = wearing
        ? s.driver.accessories.filter((x) => x !== a)
        : [...s.driver.accessories.filter((x) => accessorySlot(x) !== accessorySlot(a)), a];
      return { ...s, driver: { ...s.driver, accessories } };
    });
  };

  return (
    <ScreenShell>
      <TopBar title={t('garage.title')} onBack={onBack} right={<CoinBadge coins={save.coins} />} />
      <div className="mx-auto max-w-7xl px-4 pb-4 sm:px-8">
        <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
          {(['cars', 'paint', 'driver'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-2xl px-3 py-2.5 font-display text-sm ring-2 transition sm:text-base ${
                tab === id ? 'bg-gradient-to-br from-pink-500/40 to-violet-600/40 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
              }`}
            >
              {t(`garage.tab${id === 'cars' ? 'Cars' : id === 'paint' ? 'Paint' : 'Driver'}` as TKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-5 px-4 pb-8 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
        {/* showcase */}
        <div className="panel overflow-hidden lg:sticky lg:top-20 lg:self-start">
          <div className="relative aspect-[16/11] w-full bg-gradient-to-b from-indigo-950/60 to-black/40">
            <CarPreview
              car={car}
              driver={save.driver}
              view={tab === 'driver' ? 'driver' : 'car'}
              helmet={helmet}
              spin={tab === 'driver' ? 0.35 : 0.6}
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
            />
            {tab !== 'driver' && (
              <span className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white/80 ring-1 ring-white/10">
                {t(`body.${base.body}` as TKey)}
              </span>
            )}
            <span className="absolute right-4 top-4 text-xs text-white/50">{t('garage.rotate')}</span>
          </div>
          {tab === 'driver' ? (
            <div className="p-5">
              <button onClick={() => setHelmet((h) => !h)} className="btn-ghost w-full !py-2 text-sm">
                {helmet ? '✓ ' : ''}🪖 {t('garage.showHelmet')}
              </button>
            </div>
          ) : (
            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="font-display text-3xl sm:text-4xl">{base.name}</h2>
                <span className="text-sm text-white/60">{t('garage.maxSpeed', { v: Math.round(p.maxSpeed * 3.6) })}</span>
              </div>
              <p className="text-white/70">{carDesc(base)}</p>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-white/10 px-3 py-1">⏱ {t('garage.zeroTo100', { v: zeroTo100(base).toFixed(1) })}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">⚖️ {t('garage.mass', { v: fmtNum(massKg(base)) })}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">⚙️ {base.engine.toUpperCase()}</span>
              </div>
              <div className="space-y-2.5">
                <StatBar label={t('stat.speed')} value={base.stats.speed} color="from-rose-400 to-orange-400" />
                <StatBar label={t('stat.accel')} value={base.stats.accel} color="from-amber-300 to-yellow-500" />
                <StatBar label={t('stat.handling')} value={base.stats.handling} color="from-emerald-300 to-teal-500" />
                <StatBar label={t('stat.braking')} value={base.stats.braking} color="from-sky-300 to-blue-500" />
                <StatBar label={t('stat.weight')} value={base.stats.weight} color="from-violet-300 to-purple-500" />
              </div>
              <div className="pt-2">
                {owned ? (
                  <button onClick={select} disabled={selected} className="btn-primary w-full">
                    {selected ? t('garage.selected') : t('garage.select')}
                  </button>
                ) : (
                  <button onClick={buy} disabled={!canBuy} className="btn-primary w-full">
                    {t('garage.buy', { price: fmtNum(base.price) })}
                  </button>
                )}
                {!owned && !canBuy && (
                  <p className="mt-2 text-center text-sm text-rose-300">{t('garage.notEnough', { n: fmtNum(base.price - save.coins) })}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* right column */}
        {tab === 'cars' && (
          <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {CARS.map((c0, i) => {
              const c = paintedCar(c0, save.paints[c0.id]);
              const own = save.owned.includes(c.id);
              const active = c.id === viewId;
              return (
                <button
                  key={c.id}
                  onClick={() => setViewId(c.id)}
                  style={{ animationDelay: `${i * 25}ms` }}
                  className={`group relative animate-slideUp overflow-hidden rounded-2xl p-3 text-left ring-2 transition ${
                    active ? 'bg-white/15 ring-pink-400' : 'bg-white/[0.05] ring-white/10 hover:bg-white/10'
                  }`}
                >
                  <div
                    className="mb-3 h-16 rounded-xl"
                    style={{ background: `linear-gradient(135deg, ${c.color}, ${c.accent})`, boxShadow: c.glow ? `0 0 18px ${c.glow}` : undefined }}
                  >
                    <div className="flex h-full items-center justify-center text-3xl drop-shadow">{BODY_ICON[c.body] ?? '🚗'}</div>
                  </div>
                  <div className="truncate font-display text-sm">{c.name}</div>
                  <div className="text-xs text-white/50">{t(`body.${c.body}` as TKey)}</div>
                  <div className="mt-1 text-xs font-bold">
                    {save.selectedCar === c.id ? (
                      <span className="text-emerald-300">{t('garage.inGame')}</span>
                    ) : own ? (
                      <span className="text-sky-300">{t('garage.owned')}</span>
                    ) : (
                      <span className="text-amber-300">{fmtNum(c.price)} $</span>
                    )}
                  </div>
                  {!own && <span className="absolute right-2 top-2 text-sm">🔒</span>}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'paint' && (
          <div className="panel space-y-5 self-start p-5">
            <h3 className="font-display text-2xl">{base.name}</h3>
            {owned ? (
              <>
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t('garage.bodyColor')}</h4>
                  <Swatches colors={PAINT_COLORS} value={car.color} onPick={(c) => setPaint('color', c)} />
                </div>
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t('garage.accentColor')}</h4>
                  <Swatches colors={PAINT_COLORS} value={car.accent} onPick={(c) => setPaint('accent', c)} />
                </div>
                <button onClick={resetPaint} className="btn-ghost w-full !py-2 text-sm">
                  {t('garage.resetPaint')}
                </button>
              </>
            ) : (
              <p className="text-white/70">🔒 {t('garage.paintOwnedOnly')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {CARS.filter((c) => save.owned.includes(c.id)).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setViewId(c.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold ring-2 ${c.id === viewId ? 'bg-white/20 ring-pink-400' : 'bg-white/5 ring-white/10'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'driver' && (
          <div className="panel space-y-5 self-start p-5">
            {(
              [
                ['garage.skin', 'skin', SKIN_TONES],
                ['garage.suit', 'suit', SUIT_COLORS],
                ['garage.suitAccent', 'suitAccent', SUIT_COLORS],
                ['garage.helmet', 'helmet', HELMET_COLORS],
                ['garage.visor', 'visor', VISOR_COLORS],
                ['garage.hair', 'hair', HAIR_COLORS],
              ] as const
            ).map(([label, key, colors]) => (
              <div key={key}>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t(label)}</h4>
                <Swatches
                  colors={colors}
                  value={save.driver[key]}
                  onPick={(c) => {
                    if (key === 'helmet' || key === 'visor') setHelmet(true);
                    else if (key === 'hair' || key === 'skin') setHelmet(false);
                    setLook({ [key]: c });
                  }}
                />
              </div>
            ))}
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t('garage.accessories')}</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ACCESSORIES.map((a) => {
                  const own = save.ownedAccessories.includes(a.id);
                  const wearing = save.driver.accessories.includes(a.id);
                  const afford = save.coins >= a.price;
                  return (
                    <button
                      key={a.id}
                      disabled={!own && !afford}
                      onClick={() => toggleAccessory(a.id, a.price)}
                      className={`rounded-2xl p-3 text-left ring-2 transition disabled:opacity-40 ${
                        wearing ? 'bg-emerald-500/20 ring-emerald-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-2xl">{a.icon}</div>
                      <div className="font-bold">{t(`acc.${a.id}` as TKey)}</div>
                      <div className="text-xs font-bold">
                        {!own ? (
                          <span className="text-amber-300">{t('garage.buyAcc', { price: fmtNum(a.price) })}</span>
                        ) : wearing ? (
                          <span className="text-emerald-300">✓ {t('garage.takeOff')}</span>
                        ) : (
                          <span className="text-sky-300">{t('garage.wear')}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
