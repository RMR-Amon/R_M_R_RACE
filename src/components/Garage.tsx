import { useState } from 'react';
import CarPreview from './CarPreview';
import { CoinBadge, ScreenShell, StatBar, TopBar } from './ui';
import { CARS, carParams, getCar } from '../data/cars';
import type { SaveData } from '../store/save';
import type { BodyType } from '../game/types';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  onBack: () => void;
}

const BODY_LABEL: Record<BodyType, string> = {
  sport: 'Спорткар',
  muscle: 'Маслкар',
  f1: 'Болид',
  suv: 'Внедорожник',
  buggy: 'Багги',
  cyber: 'Кибер-кар',
  retro: 'Хэтчбек',
  kart: 'Карт',
  van: 'Фургон',
};

export default function Garage({ save, update, onBack }: Props) {
  const [viewId, setViewId] = useState(save.selectedCar);
  const car = getCar(viewId);
  const owned = save.owned.includes(car.id);
  const selected = save.selectedCar === car.id;
  const canBuy = save.coins >= car.price;
  const p = carParams(car);

  const buy = () => {
    if (owned || !canBuy) return;
    update((s) => ({ ...s, coins: s.coins - car.price, owned: [...s.owned, car.id], selectedCar: car.id }));
  };
  const select = () => update((s) => ({ ...s, selectedCar: car.id }));

  return (
    <ScreenShell>
      <TopBar title="Гараж" onBack={onBack} right={<CoinBadge coins={save.coins} />} />
      <div className="mx-auto grid max-w-7xl gap-5 px-4 pb-8 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
        {/* showcase */}
        <div className="panel overflow-hidden lg:sticky lg:top-20 lg:self-start">
          <div className="relative aspect-[16/11] w-full bg-gradient-to-b from-indigo-950/60 to-black/40">
            <CarPreview car={car} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
            <span className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white/80 ring-1 ring-white/10">
              {BODY_LABEL[car.body]}
            </span>
            <span className="absolute right-4 top-4 text-xs text-white/50">↔ крути мышкой / пальцем</span>
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-display text-3xl sm:text-4xl">{car.name}</h2>
              <span className="text-sm text-white/60">
                Макс. {Math.round(p.maxSpeed * 3.6)} км/ч
              </span>
            </div>
            <p className="text-white/70">{car.description}</p>
            <div className="space-y-2.5">
              <StatBar label="Скорость" value={car.stats.speed} color="from-rose-400 to-orange-400" />
              <StatBar label="Разгон" value={car.stats.accel} color="from-amber-300 to-yellow-500" />
              <StatBar label="Управление" value={car.stats.handling} color="from-emerald-300 to-teal-500" />
              <StatBar label="Тормоза" value={car.stats.braking} color="from-sky-300 to-blue-500" />
              <StatBar label="Масса" value={car.stats.weight} color="from-violet-300 to-purple-500" />
            </div>
            <div className="pt-2">
              {owned ? (
                <button onClick={select} disabled={selected} className="btn-primary w-full">
                  {selected ? '✓ Выбрана' : 'Выбрать'}
                </button>
              ) : (
                <button onClick={buy} disabled={!canBuy} className="btn-primary w-full">
                  Купить за {car.price.toLocaleString('ru-RU')} $
                </button>
              )}
              {!owned && !canBuy && (
                <p className="mt-2 text-center text-sm text-rose-300">
                  Не хватает {(car.price - save.coins).toLocaleString('ru-RU')} монет — побеждай в гонках!
                </p>
              )}
            </div>
          </div>
        </div>

        {/* list */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {CARS.map((c, i) => {
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
                  style={{
                    background: `linear-gradient(135deg, ${c.color}, ${c.accent})`,
                    boxShadow: c.glow ? `0 0 18px ${c.glow}` : undefined,
                  }}
                >
                  <div className="flex h-full items-center justify-center text-3xl drop-shadow">
                    {c.body === 'f1' ? '🏎️' : c.body === 'kart' ? '🛞' : c.body === 'van' ? '🚐' : c.body === 'suv' ? '🚙' : c.body === 'buggy' ? '🏜️' : '🚗'}
                  </div>
                </div>
                <div className="truncate font-display text-sm">{c.name}</div>
                <div className="text-xs text-white/50">{BODY_LABEL[c.body]}</div>
                <div className="mt-1 text-xs font-bold">
                  {save.selectedCar === c.id ? (
                    <span className="text-emerald-300">✓ В игре</span>
                  ) : own ? (
                    <span className="text-sky-300">Куплена</span>
                  ) : (
                    <span className="text-amber-300">{c.price.toLocaleString('ru-RU')} $</span>
                  )}
                </div>
                {!own && <span className="absolute right-2 top-2 text-sm">🔒</span>}
              </button>
            );
          })}
        </div>
      </div>
    </ScreenShell>
  );
}
