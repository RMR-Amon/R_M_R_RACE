import { useState } from 'react';
import CarPreview from './CarPreview';
import { Choice, CoinBadge, ScreenShell } from './ui';
import { getCar, paintedCar } from '../data/cars';
import { LANGS, t, useLang } from '../i18n';
import type { SaveData } from '../store/save';
import type { Quality } from '../game/types';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  onPlay: () => void;
  onStory: () => void;
  onGarage: () => void;
  onToggleSound: () => void;
}

export default function MainMenu({ save, update, onPlay, onStory, onGarage, onToggleSound }: Props) {
  useLang();
  const [settings, setSettings] = useState(false);
  const car = paintedCar(getCar(save.selectedCar), save.paints[save.selectedCar]);
  return (
    <ScreenShell>
      <div className="mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-4 pb-6 pt-4 sm:px-8">
        <header className="flex items-center justify-between gap-2">
          <CoinBadge coins={save.coins} />
          <div className="flex gap-2">
            <button onClick={() => setSettings(true)} className="btn-ghost !px-3 !py-2 text-xl" aria-label={t('menu.settings')}>
              ⚙️
            </button>
            <button onClick={onToggleSound} className="btn-ghost !px-3 !py-2 text-xl" aria-label="sound">
              {save.muted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-6 py-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-start lg:text-left">
            <p className="mb-2 animate-slideUp rounded-full bg-white/10 px-4 py-1 text-xs font-extrabold uppercase tracking-[0.3em] text-pink-200 ring-1 ring-white/15">
              {t('menu.tagline')}
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
            <p className="mt-4 max-w-md animate-slideUp text-base text-white/70 sm:text-lg">{t('menu.desc')}</p>

            <div className="mt-8 flex w-full max-w-sm flex-col gap-4">
              <button onClick={onStory} className="btn-primary w-full !py-4 text-2xl">
                {t('menu.story')}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={onPlay} className="btn-ghost w-full !py-4 text-base">
                  {t('menu.play')}
                </button>
                <button onClick={onGarage} className="btn-ghost w-full !py-4 text-base">
                  {t('menu.garage')}
                </button>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-6 text-sm text-white/60">
              <span>
                🏁 {t('menu.races')}: <b className="text-white">{save.races}</b>
              </span>
              <span>
                🏆 {t('menu.wins')}: <b className="text-white">{save.wins}</b>
              </span>
              <span>
                📖 <b className="text-white">{save.storyDone}</b>/100
              </span>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="relative mx-auto aspect-[4/3] w-full max-w-xl">
              <div className="absolute inset-[12%] rounded-full bg-fuchsia-500/30 blur-3xl" />
              <CarPreview car={car} driver={save.driver} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1 font-display text-sm tracking-wider ring-1 ring-white/15">
                {car.name}
              </div>
            </div>
          </div>
        </div>

        <footer className="text-center text-xs text-white/40">
          <span className="hidden sm:inline">{t('menu.controls')} · </span>
          <span className="font-display tracking-wider text-white/60">© R_M_R</span>
        </footer>
      </div>

      {settings && <Settings save={save} update={update} onClose={() => setSettings(false)} />}
    </ScreenShell>
  );
}

function Settings({ save, update, onClose }: { save: SaveData; update: Props['update']; onClose: () => void }) {
  useLang();
  const toggle = (key: 'mirrors' | 'intro') => update((s) => ({ ...s, [key]: !s[key] }));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel w-full max-w-lg animate-pop space-y-5 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-3xl">{t('settings.title')}</h2>
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t('settings.language')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => update((s) => ({ ...s, lang: l.id }))}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 font-bold ring-2 transition ${
                  save.lang === l.id ? 'bg-white/20 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                }`}
              >
                <span className="text-xl">{l.flag}</span>
                {l.name}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{t('settings.quality')}</h3>
          <Choice<Quality>
            value={save.quality}
            onPick={(q) => update((s) => ({ ...s, quality: q }))}
            options={(['low', 'medium', 'high'] as const).map((q) => ({ id: q, label: t(`quality.${q}`) }))}
          />
          <p className="mt-2 text-xs text-white/50">{t('settings.qualityHint')}</p>
        </section>
        <section className="space-y-2">
          {(['mirrors', 'intro'] as const).map((k) => (
            <button key={k} onClick={() => toggle(k)} className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10 hover:bg-white/10">
              <span className="font-bold">{t(`settings.${k}`)}</span>
              <span className={`rounded-full px-3 py-0.5 text-sm font-black ${save[k] ? 'bg-emerald-400 text-black' : 'bg-white/15 text-white/70'}`}>
                {save[k] ? t('common.on') : t('common.off')}
              </span>
            </button>
          ))}
        </section>
        <button onClick={onClose} className="btn-primary w-full">
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
