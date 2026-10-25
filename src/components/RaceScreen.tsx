import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Game } from '../game/engine';
import { ITEM_INFO, ITEM_LIST } from '../game/items';
import type { HudState, RaceConfig, RaceResult } from '../game/types';
import type { Input } from '../game/input';

interface Props {
  config: RaceConfig;
  muted: boolean;
  onToggleSound: () => void;
  onFinish: (r: RaceResult) => void;
  onExit: () => void;
  onRestart: () => void;
}

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const useIsTouch = () => {
  const [touch] = useState(
    () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0),
  );
  return touch;
};

export default function RaceScreen({ config, muted, onToggleSound, onFinish, onExit, onRestart }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const touch = useIsTouch();

  useEffect(() => {
    const game = new Game(host.current!, minimap.current, config, {
      onHud: setHud,
      onFinish: (r) => finishRef.current(r),
      onPauseRequest: () => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      },
    });
    gameRef.current = game;
    if (location.search.includes('debug')) (window as unknown as { __game: Game }).__game = game;
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, [config]);

  useEffect(() => {
    gameRef.current?.setPaused(paused);
    pausedRef.current = paused;
  }, [paused]);

  const battle = config.mode.kind === 'battle';

  return (
    <div className="relative h-[100dvh] w-full touch-none select-none overflow-hidden bg-black">
      <div ref={host} className="absolute inset-0" />

      {/* -------- top HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-4 [padding-top:max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex flex-col gap-2">
          {hud && (
            <div className="rounded-2xl bg-black/45 px-3 py-2 ring-1 ring-white/15 backdrop-blur sm:px-4">
              {battle ? (
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl text-amber-300 sm:text-5xl">{hud.points}</span>
                  <span className="text-xs font-bold uppercase text-white/60">очков</span>
                </div>
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-4xl leading-none text-white sm:text-6xl">{hud.place}</span>
                  <span className="font-display text-lg text-white/60 sm:text-2xl">/{hud.total}</span>
                </div>
              )}
              <div className="mt-0.5 text-xs font-bold uppercase tracking-wider text-white/70 sm:text-sm">
                {battle ? `⏱ ${fmtTime(hud.timeLeft).slice(0, -3)}` : `Круг ${hud.lap}/${hud.laps}`}
              </div>
              {!battle && <div className="font-mono text-xs text-white/60 sm:text-sm">{fmtTime(hud.time)}</div>}
            </div>
          )}
          {hud && <Standings hud={hud} battle={battle} />}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex gap-2">
            <button onClick={onToggleSound} className="grid h-10 w-10 place-items-center rounded-xl bg-black/45 text-lg ring-1 ring-white/15 backdrop-blur">
              {muted ? '🔇' : '🔊'}
            </button>
            <button onClick={() => setPaused(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-black/45 text-lg font-black ring-1 ring-white/15 backdrop-blur">
              ❚❚
            </button>
          </div>
          <div className="rounded-2xl bg-black/35 p-1.5 ring-1 ring-white/15 backdrop-blur">
            <canvas ref={minimap} className="h-24 w-24 sm:h-36 sm:w-36" />
          </div>
        </div>
      </div>

      {/* -------- item slot */}
      {hud && <ItemSlot hud={hud} touch={touch} onUse={() => gameRef.current?.input.fire()} />}

      {/* -------- speedometer */}
      {hud && (
        <div className={`pointer-events-none absolute ${touch ? 'bottom-48 right-1/2 translate-x-1/2' : 'bottom-5 right-5'} text-right`}>
          <div className="flex items-baseline justify-end gap-1">
            <span className={`font-display text-5xl tabular-nums text-outline sm:text-6xl ${hud.boost > 0 ? 'text-amber-300' : 'text-white'}`}>
              {hud.speedKmh}
            </span>
            <span className="text-sm font-bold text-white/70">км/ч</span>
          </div>
          <div className="flex justify-end gap-1.5 text-xs font-bold">
            {hud.boost > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-black">⚡ НИТРО</span>}
            {hud.shield > 0 && <span className="rounded-full bg-sky-400 px-2 py-0.5 text-black">🛡️ {Math.ceil(hud.shield)}с</span>}
            {hud.frozen && <span className="rounded-full bg-cyan-200 px-2 py-0.5 text-black">❄️ ЗАМОРОЖЕН</span>}
          </div>
        </div>
      )}

      {/* -------- countdown + toasts */}
      {hud && hud.phase === 'countdown' && hud.countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span key={hud.countdown} className="animate-pop font-display text-[9rem] leading-none text-white text-outline sm:text-[12rem]">
            {hud.countdown}
          </span>
        </div>
      )}
      {hud && <Toast text={hud.message} id={hud.messageId} />}
      {hud?.frozen && <div className="pointer-events-none absolute inset-0 bg-cyan-200/20 shadow-[inset_0_0_120px_rgba(165,243,252,.9)]" />}
      {hud && hud.boost > 0 && <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_140px_rgba(251,191,36,.35)]" />}

      {/* -------- touch controls */}
      {touch && gameRef.current && <TouchControls input={gameRef.current.input} />}

      {/* -------- pause */}
      {paused && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-sm animate-pop space-y-3 p-6 text-center">
            <h2 className="font-display text-4xl">Пауза</h2>
            <button onClick={() => setPaused(false)} className="btn-primary w-full">▶ Продолжить</button>
            <button onClick={onRestart} className="btn-ghost w-full">↻ Заново</button>
            <button onClick={onExit} className="btn-ghost w-full">⌂ В меню</button>
            <p className="pt-2 text-xs text-white/50">WASD / стрелки — езда · Пробел — предмет</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Standings({ hud, battle }: { hud: HudState; battle: boolean }) {
  return (
    <div className="hidden w-44 overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10 backdrop-blur sm:block">
      {hud.standings.map((s) => (
        <div
          key={s.id}
          className={`flex items-center gap-2 px-3 py-1 text-sm ${s.isPlayer ? 'bg-white/20 font-black' : 'text-white/80'}`}
        >
          <span className="w-4 font-display text-white/60">{s.place}</span>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/50" style={{ background: s.color }} />
          <span className="flex-1 truncate">{s.name}</span>
          {battle ? <span className="font-display text-amber-300">{s.points}</span> : s.finished ? <span>🏁</span> : null}
        </div>
      ))}
    </div>
  );
}

function ItemSlot({ hud, touch, onUse }: { hud: HudState; touch: boolean; onUse: () => void }) {
  const [spinIdx, setSpinIdx] = useState(0);
  useEffect(() => {
    if (!hud.rouletting) return;
    const t = setInterval(() => setSpinIdx((i) => (i + 1) % ITEM_LIST.length), 70);
    return () => clearInterval(t);
  }, [hud.rouletting]);

  const shown = hud.rouletting ? ITEM_LIST[spinIdx] : hud.item;
  const info = shown ? ITEM_INFO[shown] : null;
  const ready = !!hud.item && !hud.rouletting;

  return (
    <div className={`absolute left-1/2 top-2 -translate-x-1/2 sm:top-4 ${touch ? 'pointer-events-none' : 'pointer-events-auto'}`}>
      <button
        onClick={onUse}
        className={`relative grid h-16 w-16 place-items-center rounded-2xl text-4xl ring-4 backdrop-blur transition sm:h-24 sm:w-24 sm:text-6xl ${
          ready ? 'animate-pulse bg-white/25 ring-yellow-300' : 'bg-black/40 ring-white/20'
        }`}
        style={ready && info ? { boxShadow: `0 0 30px ${info.color}` } : undefined}
      >
        {info ? <span className={hud.rouletting ? 'scale-90 opacity-80' : 'animate-pop'}>{info.icon}</span> : <span className="text-2xl text-white/30">?</span>}
        {hud.item === 'ice' && ready && (
          <span className="absolute -bottom-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-cyan-400 font-display text-sm text-black ring-2 ring-white">
            {hud.itemCharges}
          </span>
        )}
      </button>
      {ready && info && (
        <div className="mt-1 text-center text-[10px] font-extrabold uppercase tracking-wider text-white text-outline sm:text-xs">
          {info.name}
          {!touch && <span className="text-white/60"> · Пробел</span>}
        </div>
      )}
    </div>
  );
}

function Toast({ text, id }: { text: string; id: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!id) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1600);
    return () => clearTimeout(t);
  }, [id]);
  if (!visible || !text) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[26%] flex justify-center px-4">
      <span key={id} className="animate-pop rounded-2xl bg-black/50 px-5 py-2 text-center font-display text-2xl text-white text-outline ring-1 ring-white/20 backdrop-blur sm:text-4xl">
        {text}
      </span>
    </div>
  );
}

function HoldButton({
  onChange,
  className,
  children,
}: {
  onChange: (down: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    setDown(v);
    onChange(v);
  };
  return (
    <button
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`${className} touch-none select-none transition-transform ${down ? 'scale-90 brightness-125' : ''}`}
    >
      {children}
    </button>
  );
}

function TouchControls({ input }: { input: Input }) {
  const base = 'grid place-items-center rounded-full font-display text-white ring-2 ring-white/30 backdrop-blur-md shadow-xl';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex gap-3">
        <HoldButton onChange={(v) => (input.touch.left = v)} className={`${base} h-20 w-20 bg-white/15 text-3xl sm:h-24 sm:w-24`}>
          ◀
        </HoldButton>
        <HoldButton onChange={(v) => (input.touch.right = v)} className={`${base} h-20 w-20 bg-white/15 text-3xl sm:h-24 sm:w-24`}>
          ▶
        </HoldButton>
      </div>
      <div className="pointer-events-auto flex items-end gap-3">
        <div className="flex flex-col items-center gap-3">
          <HoldButton onChange={(v) => v && input.fire()} className={`${base} h-16 w-16 bg-fuchsia-500/50 text-2xl`}>
            🎯
          </HoldButton>
          <HoldButton onChange={(v) => (input.touch.brake = v)} className={`${base} h-16 w-16 bg-rose-600/50 text-sm`}>
            ТОРМ
          </HoldButton>
        </div>
        <HoldButton onChange={(v) => (input.touch.gas = v)} className={`${base} h-24 w-24 bg-emerald-500/50 text-lg sm:h-28 sm:w-28`}>
          ГАЗ
        </HoldButton>
      </div>
    </div>
  );
}
