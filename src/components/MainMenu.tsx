import CarPreview from './CarPreview';
import { CoinBadge, ScreenShell } from './ui';
import { getCar } from '../data/cars';
import type { SaveData } from '../store/save';

interface Props {
  save: SaveData;
  onPlay: () => void;
  onGarage: () => void;
  onToggleSound: () => void;
}

export default function MainMenu({ save, onPlay, onGarage, onToggleSound }: Props) {
  const car = getCar(save.selectedCar);
  return (
    <ScreenShell>
      <div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-4 pb-6 pt-4 sm:px-8">
        <header className="flex items-center justify-between">
          <CoinBadge coins={save.coins} />
          <button onClick={onToggleSound} className="btn-ghost !px-3 !py-2 text-xl" aria-label="Звук">
            {save.muted ? '🔇' : '🔊'}
          </button>
        </header>

        <div className="grid flex-1 items-center gap-6 py-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-start lg:text-left">
            <p className="mb-2 animate-slideUp rounded-full bg-white/10 px-4 py-1 text-xs font-extrabold uppercase tracking-[0.3em] text-pink-200 ring-1 ring-white/15">
              Аркадные 3D гонки
            </p>
            <h1 className="animate-slideUp font-display text-6xl leading-[0.9] sm:text-7xl lg:text-8xl">
              <span className="bg-gradient-to-br from-yellow-200 via-orange-400 to-rose-500 bg-clip-text text-transparent drop-shadow-[0_6px_0_rgba(127,29,29,.6)]">
                R_M_R
              </span>
              <br />
              <span className="bg-gradient-to-br from-cyan-200 via-sky-400 to-violet-500 bg-clip-text text-transparent drop-shadow-[0_6px_0_rgba(30,27,75,.8)]">
                RACE
              </span>
            </h1>
            <p className="mt-4 max-w-md animate-slideUp text-base text-white/70 sm:text-lg">
              5 миров, 14 машин, лаки-блоки с ракетами, бомбами и ледяными зарядами, трамплины над пропастью и
              арена битвы!
            </p>

            <div className="mt-8 flex w-full max-w-sm flex-col gap-4">
              <button onClick={onPlay} className="btn-primary w-full !py-4 text-2xl">
                ▶ Играть
              </button>
              <button onClick={onGarage} className="btn-ghost w-full !py-4 text-lg">
                🚗 Гараж
              </button>
            </div>

            <div className="mt-6 flex gap-6 text-sm text-white/60">
              <span>
                🏁 Гонок: <b className="text-white">{save.races}</b>
              </span>
              <span>
                🏆 Побед: <b className="text-white">{save.wins}</b>
              </span>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="relative mx-auto aspect-[4/3] w-full max-w-xl">
              <div className="absolute inset-[12%] rounded-full bg-fuchsia-500/30 blur-3xl" />
              <CarPreview car={car} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1 font-display text-sm tracking-wider ring-1 ring-white/15">
                {car.name}
              </div>
            </div>
          </div>
        </div>

        <footer className="text-center text-xs text-white/40">
          <span className="hidden sm:inline">Управление: WASD / стрелки · Пробел — использовать предмет · Esc — пауза · </span>
          <span className="font-display tracking-wider text-white/60">© R_M_R</span>
        </footer>
      </div>
    </ScreenShell>
  );
}
