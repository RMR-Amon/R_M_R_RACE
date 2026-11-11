import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Game, type MirrorViews } from '../game/engine';
import { ITEM_INFO, ITEM_LIST, itemName } from '../game/items';
import { t, useLang } from '../i18n';
import type { HudState, RaceConfig, RaceResult } from '../game/types';
import type { Input } from '../game/input';

interface Props {
  config: RaceConfig;
  muted: boolean;
  onToggleSound: () => void;
  mirrors: boolean;
  onToggleMirrors: () => void;
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

export default function RaceScreen({ config, muted, onToggleSound, mirrors, onToggleMirrors, onFinish, onExit, onRestart }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);
  const mirrorLeft = useRef<HTMLDivElement>(null);
  const mirrorRear = useRef<HTMLDivElement>(null);
  const mirrorRight = useRef<HTMLDivElement>(null);
  const toggleMirrorsRef = useRef(onToggleMirrors);
  toggleMirrorsRef.current = onToggleMirrors;
  const mirrorsRef = useRef(mirrors);
  mirrorsRef.current = mirrors;
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const touch = useIsTouch();
  useLang();

  useEffect(() => {
    const views: MirrorViews = { left: mirrorLeft.current!, rear: mirrorRear.current!, right: mirrorRight.current! };
    const game = new Game(
      host.current!,
      minimap.current,
      config,
      {
        onHud: setHud,
        onFinish: (r) => finishRef.current(r),
        onPauseRequest: () => {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        },
        onToggleMirrors: () => toggleMirrorsRef.current(),
      },
      views,
      mirrorsRef.current,
    );
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

  useEffect(() => {
    gameRef.current?.setMirrors(mirrors);
  }, [mirrors]);

  const battle = config.mode.kind === 'battle';

  return (
    <div className="relative h-[100dvh] w-full touch-none select-none overflow-hidden bg-black">
      <div ref={host} className="absolute inset-0" />

      {/* -------- top HUD */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-4 [padding-top:max(0.5rem,env(safe-area-inset-top))] ${hud?.phase === 'intro' ? 'invisible' : ''}`}>
        <div className="flex flex-col gap-2">
          {hud && (
            <div className="rounded-2xl bg-black/45 px-2.5 py-1.5 ring-1 ring-white/15 backdrop-blur sm:px-4 sm:py-2 short:px-2.5 short:py-1">
              {battle ? (
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-2xl text-amber-300 sm:text-5xl short:text-3xl">{hud.points}</span>
                  <span className="text-xs font-bold uppercase text-white/60">{t('hud.points')}</span>
                </div>
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-3xl leading-none text-white sm:text-6xl short:text-3xl">{hud.place}</span>
                  <span className="font-display text-base text-white/60 sm:text-2xl short:text-lg">/{hud.total}</span>
                </div>
              )}
              <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-white/70 sm:text-sm short:text-[11px]">
                {battle ? `⏱ ${fmtTime(hud.timeLeft).slice(0, -3)}` : t('hud.lap', { lap: hud.lap, laps: hud.laps })}
              </div>
              {!battle && <div className="font-mono text-[11px] text-white/60 sm:text-sm short:text-[11px]">{fmtTime(hud.time)}</div>}
            </div>
          )}
          {hud && <Standings hud={hud} battle={battle} />}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex gap-2">
            <button
              onClick={onToggleMirrors}
              title={t('hud.mirrors')}
              className={`hud-btn grid place-items-center rounded-xl text-base ring-1 backdrop-blur ${mirrors ? 'bg-sky-500/40 ring-sky-300/60' : 'bg-black/45 ring-white/15'}`}
            >
              🪞
            </button>
            <button onClick={onToggleSound} className="hud-btn grid place-items-center rounded-xl bg-black/45 text-base ring-1 ring-white/15 backdrop-blur">
              {muted ? '🔇' : '🔊'}
            </button>
            <button onClick={() => setPaused(true)} className="hud-btn grid place-items-center rounded-xl bg-black/45 text-sm font-black ring-1 ring-white/15 backdrop-blur">
              ❚❚
            </button>
          </div>
          <div className="rounded-2xl bg-black/35 p-1 ring-1 ring-white/15 backdrop-blur sm:p-1.5">
            <canvas ref={minimap} className="minimap" />
          </div>
        </div>
      </div>

      {/* -------- top centre: rear-view camera + side mirrors, missile warning, item slot */}
      <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center gap-1.5 sm:top-3 sm:gap-2 [padding-top:env(safe-area-inset-top)]">
        <div className={`flex items-start gap-1.5 sm:gap-2.5 ${mirrors && hud?.phase !== 'intro' ? '' : 'hidden'}`}>
          <MirrorFrame ref={mirrorLeft} className="mirror-side mt-1" />
          <MirrorFrame ref={mirrorRear} label={t('hud.rear')} className="mirror-rear" />
          <MirrorFrame ref={mirrorRight} className="mirror-side mt-1" />
        </div>
        {hud?.incoming && <MissileWarning time={hud.incoming.time} dist={hud.incoming.dist} touch={touch} />}
        {hud && hud.phase !== 'intro' && <ItemSlot hud={hud} touch={touch} onUse={() => gameRef.current?.input.fire()} />}
        {hud?.ownMissile != null && (
          <span className="rounded-full bg-black/55 px-3 py-0.5 font-display text-xs text-white ring-1 ring-white/20 sm:text-sm">
            {t('hud.ownMissile', { s: hud.ownMissile.toFixed(1) })}
          </span>
        )}
      </div>
      {hud?.incoming && (
        <div className="pointer-events-none absolute inset-0 animate-pulse shadow-[inset_0_0_120px_rgba(239,68,68,.55)]" />
      )}

      {/* -------- speedometer */}
      {hud && (
        <div className={`pointer-events-none absolute ${touch ? 'speedo-touch left-1/2 -translate-x-1/2' : 'bottom-5 right-5'} text-right`}>
          <div className="flex items-baseline justify-end gap-1">
            <span className={`font-display text-4xl tabular-nums text-outline sm:text-6xl short:text-4xl ${hud.boost > 0 ? 'text-amber-300' : 'text-white'}`}>
              {hud.speedKmh}
            </span>
            <span className="text-sm font-bold text-white/70">{t('hud.kmh')}</span>
            {hud.phase !== 'intro' && (
              <span className="ml-1 grid h-8 w-8 place-items-center rounded-xl bg-black/50 font-display text-lg text-white ring-1 ring-white/20 sm:h-9 sm:w-9 sm:text-xl" title={t('hud.gear')}>
                {hud.speedKmh < 1 && hud.gear === 1 ? 'N' : hud.gear}
              </span>
            )}
          </div>
          {hud.difficulty === 'impossible' && (
            <div className={`mb-1 text-xs font-black uppercase tracking-wider ${hud.mistakes > 3 ? 'text-rose-400' : 'text-white/80'}`}>
              😈 {t('hud.mistakes', { n: hud.mistakes })}
            </div>
          )}
          <div className="flex justify-end gap-1.5 text-xs font-bold">
            {hud.drift > 0.08 && (
              <span className={`rounded-full px-2 py-0.5 text-black ${hud.drift >= 0.55 ? 'bg-orange-400' : 'bg-white/70'}`}>
                {t('hud.drift', { n: Math.round(hud.drift * 100) })}
              </span>
            )}
            {hud.fly > 0 && <span className="rounded-full bg-violet-400 px-2 py-0.5 text-black">{t('hud.fly', { s: Math.ceil(hud.fly) })}</span>}
            {hud.boost > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-black">{t('hud.nitro')}</span>}
            {hud.shield > 0 && <span className="rounded-full bg-sky-400 px-2 py-0.5 text-black">🛡️ {Math.ceil(hud.shield)}с</span>}
            {hud.frozen && <span className="rounded-full bg-cyan-200 px-2 py-0.5 text-black">{t('hud.frozen')}</span>}
          </div>
        </div>
      )}

      {/* -------- intro: drivers walk to their cars */}
      {hud?.phase === 'intro' && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-4">
            <span className="animate-pop rounded-2xl bg-black/50 px-5 py-2 text-center font-display text-2xl text-white text-outline ring-1 ring-white/20 backdrop-blur sm:px-6 sm:py-3 sm:text-5xl short:text-3xl">
              {t('hud.ready')}
            </span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[9vh] bg-black" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[9vh] bg-black" />
          <button
            onClick={() => gameRef.current?.skipIntro()}
            className="btn-ghost absolute bottom-[11vh] right-4 z-10 !py-2 text-sm"
          >
            {t('hud.skip')}
          </button>
        </>
      )}

      {/* -------- countdown + toasts */}
      {hud && hud.phase === 'countdown' && hud.countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span key={hud.countdown} className="animate-pop font-display text-[clamp(4.5rem,24vmin,12rem)] leading-none text-white text-outline">
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
            <h2 className="font-display text-4xl">{t('pause.title')}</h2>
            <button onClick={() => setPaused(false)} className="btn-primary w-full">{t('pause.resume')}</button>
            <button onClick={onRestart} className="btn-ghost w-full">{t('pause.restart')}</button>
            <button onClick={onExit} className="btn-ghost w-full">{t('pause.menu')}</button>
            <p className="pt-2 text-xs text-white/50">{t('pause.hint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const MirrorFrame = forwardRef<HTMLDivElement, { className: string; label?: string }>(function MirrorFrame({ className, label }, ref) {
  // the 3D view is rendered by the engine into this rectangle; the div only draws the frame
  return (
    <div ref={ref} className={`relative rounded-lg ring-[3px] ring-zinc-900/90 shadow-[0_4px_14px_rgba(0,0,0,.5),inset_0_0_0_1px_rgba(255,255,255,.35)] ${className}`}>
      {label && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900/90 px-2 text-[9px] font-extrabold uppercase tracking-widest text-white/70 sm:text-[10px]">
          {label}
        </span>
      )}
    </div>
  );
});

function MissileWarning({ time, dist, touch }: { time: number; dist: number; touch: boolean }) {
  return (
    <div className="animate-pulse rounded-2xl bg-red-600/85 px-4 py-1.5 text-center ring-2 ring-white/80 shadow-[0_0_30px_rgba(239,68,68,.8)]">
      <div className="font-display text-sm text-white sm:text-xl">{t('hud.incoming')}</div>
      <div className="text-[11px] font-bold text-white/90 sm:text-sm">
        {t(touch ? 'hud.incomingSub' : 'hud.incomingSubKb', { d: dist, s: time.toFixed(1) })}
      </div>
    </div>
  );
}

function Standings({ hud, battle }: { hud: HudState; battle: boolean }) {
  return (
    <div className="hidden w-44 overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10 backdrop-blur sm:block short:hidden">
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
    <div className={touch ? 'pointer-events-none' : 'pointer-events-auto'}>
      <button
        onClick={onUse}
        className={`item-slot relative grid place-items-center rounded-2xl ring-[3px] backdrop-blur transition ${
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
          {shown && itemName(shown)}
          {!touch && <span className="text-white/60"> · {t('hud.space')}</span>}
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
      <span key={id} className="animate-pop rounded-2xl bg-black/50 px-4 py-1.5 text-center font-display text-xl text-white text-outline ring-1 ring-white/20 backdrop-blur sm:px-5 sm:py-2 sm:text-4xl short:text-2xl">
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
  const base = 'grid place-items-center rounded-full font-display text-white ring-2 ring-white/25 backdrop-blur-md shadow-lg';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-3 pt-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] [padding-left:max(0.75rem,env(safe-area-inset-left))] [padding-right:max(0.75rem,env(safe-area-inset-right))]">
      <div className="pointer-events-auto flex gap-2.5">
        <HoldButton onChange={(v) => (input.touch.left = v)} className={`${base} tc-md bg-white/15 text-xl`}>
          ◀
        </HoldButton>
        <HoldButton onChange={(v) => (input.touch.right = v)} className={`${base} tc-md bg-white/15 text-xl`}>
          ▶
        </HoldButton>
      </div>
      <div className="pointer-events-auto flex items-end gap-2">
        <div className="flex flex-col items-center gap-2">
          <HoldButton onChange={(v) => v && input.fire()} className={`${base} tc-sm bg-fuchsia-500/50 text-lg`}>
            🎯
          </HoldButton>
          <HoldButton onChange={(v) => (input.touch.brake = v)} className={`${base} tc-sm bg-rose-600/50 text-[10px]`}>
            {t('touch.brake')}
          </HoldButton>
        </div>
        <HoldButton onChange={(v) => (input.touch.drift = v)} className={`${base} tc-sm bg-orange-500/50 text-[10px]`}>
          {t('touch.drift')}
        </HoldButton>
        <HoldButton onChange={(v) => (input.touch.gas = v)} className={`${base} tc-lg bg-emerald-500/50 text-sm`}>
          {t('touch.gas')}
        </HoldButton>
      </div>
    </div>
  );
}
