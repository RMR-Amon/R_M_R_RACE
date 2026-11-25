import { useEffect, useRef, useState } from 'react';
import { ScreenShell } from '../ui';
import { Avatar, ErrorModal, NoticeToasts, PingBadge, RoomSettingsForm, errorText, matchLabel, profileFromSave } from './common';
import { CARS, getCar, paintedCar } from '../../data/cars';
import { NET } from '../../net/config';
import { serviceHost, shareAddress, useRooms } from '../../net/lanService';
import { LanAddress } from './LanAddress';
import { net, useNet } from '../../net/session';
import { t, useLang } from '../../i18n';
import type { RoomSettings, RoomState } from '../../net/protocol';
import type { SaveData } from '../../store/save';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  /** left / kicked / room closed: back to the multiplayer menu */
  onExit: () => void;
}

export default function Lobby({ save, update, onExit }: Props) {
  useLang();
  const view = useNet();
  const room = view.room;
  const me = room?.players.find((p) => p.id === view.you);
  const isHost = !!room && room.hostId === view.you;
  const [confirmClose, setConfirmClose] = useState(false);

  // my car / name / driver go to the room whenever they change here or in the garage
  const lastSent = useRef('');
  useEffect(() => {
    if (view.phase !== 'lobby' || !me) return;
    const p = profileFromSave(save);
    const key = JSON.stringify(p);
    const mine = JSON.stringify({ name: me.name, carId: me.carId, paint: me.paint, look: me.look });
    if (key !== lastSent.current && key !== mine) {
      lastSent.current = key;
      net.setProfile(p);
    }
  }, [save, view.phase, me]);

  if (view.phase === 'ended' && view.fatal) {
    return (
      <ScreenShell>
        <ErrorModal
          code={view.fatal.code}
          detail={view.fatal.detail}
          onClose={() => {
            net.dismiss();
            onExit();
          }}
        />
      </ScreenShell>
    );
  }

  if (!room || !me || view.phase === 'connecting') {
    return (
      <ScreenShell>
        <div className="grid min-h-[100dvh] place-items-center p-6 text-center">
          <div className="space-y-4">
            <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-white/15 border-t-pink-400" />
            <div className="font-display text-2xl">{t('mp.connecting')}</div>
            <button
              className="btn-ghost"
              onClick={() => {
                net.leave();
                onExit();
              }}
            >
              {t('mp.cancel')}
            </button>
          </div>
        </div>
      </ScreenShell>
    );
  }

  const leave = () => {
    net.leave();
    onExit();
  };

  return (
    <ScreenShell>
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-[#0b0820]/75 px-3 py-2 backdrop-blur-md sm:px-8 sm:py-3 [padding-top:max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={leave} className="btn-ghost shrink-0 !px-3 !py-1.5 text-sm sm:!px-4 sm:!py-2">
          ←<span className="hidden sm:inline"> {t('lobby.leave')}</span>
        </button>
        <div className="min-w-0 text-center">
          <h1 className="truncate font-display text-lg uppercase tracking-wider sm:text-3xl">{room.settings.name}</h1>
          <div className="truncate text-[11px] text-white/55 sm:text-sm">{matchLabel(room.settings)}</div>
        </div>
        <ConnChip conn={view.conn} rtt={view.rtt} />
      </div>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 pb-36 pt-2 sm:px-8 lg:grid-cols-[1.15fr_1fr]">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-display text-lg uppercase tracking-wider text-white/80">
              {t('lobby.title')} · <span className="text-amber-300">{t('lobby.count', { n: room.players.length, max: room.settings.maxPlayers })}</span>
            </h2>
            {room.code && (
              <span className="rounded-2xl bg-white/10 px-3 py-1 font-display text-sm ring-1 ring-white/20">
                🔒 {t('lobby.code')}: <span className="tracking-[0.3em] text-amber-300">{room.code}</span>
              </span>
            )}
          </div>
          <div className="space-y-2">
            {room.players.map((p, i) => {
              const car = paintedCar(getCar(p.carId), p.paint ?? undefined);
              return (
                <div
                  key={p.id}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={`flex animate-slideUp items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 transition ${
                    p.id === view.you ? 'bg-white/[0.12] ring-pink-400/50' : 'bg-white/[0.05] ring-white/10'
                  } ${p.status !== 'online' ? 'opacity-60' : ''}`}
                >
                  <Avatar profile={p} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-base">{p.name}</span>
                      {p.host && <span title={t('lobby.hostBadge')}>👑</span>}
                      {p.id === view.you && <span className="rounded-full bg-pink-500/30 px-1.5 text-[10px] font-black uppercase">{t('lobby.you')}</span>}
                    </div>
                    <div className="truncate text-xs text-white/55">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: car.color }} />
                      {car.name}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.status === 'online' ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${p.ready ? 'bg-emerald-400 text-black' : 'bg-white/10 text-white/60'}`}>
                        {p.host ? t('lobby.hostBadge') : p.ready ? `✓ ${t('lobby.ready')}` : t('lobby.notReady')}
                      </span>
                    ) : (
                      <span className="animate-pulse rounded-full bg-amber-400/25 px-2 py-0.5 text-[11px] font-bold text-amber-100">{t('lobby.reconnecting')}</span>
                    )}
                    <PingBadge ms={p.ping} />
                  </div>
                  {isHost && p.id !== view.you && (
                    <button onClick={() => net.kick(p.id)} className="rounded-xl bg-rose-500/20 px-2 py-1.5 text-xs font-bold text-rose-200 ring-1 ring-rose-400/40 hover:bg-rose-500/35" title={t('lobby.kick')}>
                      ✕<span className="hidden sm:inline"> {t('lobby.kick')}</span>
                    </button>
                  )}
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, room.settings.maxPlayers - room.players.length) }, (_, i) => (
              <div key={`free${i}`} className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-white/10 px-3 py-2.5 text-sm text-white/30">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/5 text-xl">＋</span>
                {t('lobby.freeSlot')}
              </div>
            ))}
          </div>
          <InviteHint />
        </section>

        <div className="space-y-5">
          <section className="panel space-y-3 p-4 sm:p-5">
            <h2 className="font-display text-lg uppercase tracking-wider text-white/80">{t('lobby.yourCar')}</h2>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {CARS.filter((c) => save.owned.includes(c.id)).map((c) => {
                const car = paintedCar(c, save.paints[c.id]);
                const active = save.selectedCar === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => update((s) => ({ ...s, selectedCar: c.id }))}
                    className={`shrink-0 rounded-2xl px-3 py-2 text-left ring-2 transition ${active ? 'bg-white/20 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'}`}
                  >
                    <span className="mb-1 block h-2 w-14 rounded-full" style={{ background: `linear-gradient(90deg, ${car.color}, ${car.accent})` }} />
                    <span className="block whitespace-nowrap font-display text-xs">{car.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel space-y-3 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg uppercase tracking-wider text-white/80">{t('lobby.settings')}</h2>
              {!isHost && <span className="text-xs text-white/50">{t('lobby.onlyHost')}</span>}
            </div>
            <HostSettings room={room} isHost={isHost} />
          </section>
        </div>
      </div>

      <BottomBar room={room} isHost={isHost} ready={me.ready} onClose={() => setConfirmClose(true)} />

      {view.warn && <WarnToast code={view.warn.code} detail={view.warn.detail} id={view.warn.id} />}
      <NoticeToasts notices={view.notices} />

      {confirmClose && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setConfirmClose(false)}>
          <div className="panel w-full max-w-sm animate-pop space-y-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl">🚪</div>
            <p className="font-display text-xl">{t('lobby.closeConfirm')}</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setConfirmClose(false)}>
                {t('mp.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  net.closeRoom();
                  onExit();
                }}
              >
                {t('lobby.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}

/** host: edits are sent to the room (debounced); others: read-only */
function HostSettings({ room, isHost }: { room: RoomState; isHost: boolean }) {
  const [draft, setDraft] = useState<RoomSettings>(room.settings);
  const timer = useRef(0);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(room.settings);
  }, [room.settings]);
  const change = (s: RoomSettings) => {
    setDraft(s);
    editing.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      editing.current = false;
      net.setSettings(s);
    }, 350);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return <RoomSettingsForm compact value={isHost ? draft : room.settings} onChange={change} disabled={!isHost} minPlayers={Math.max(NET.MIN_PLAYERS, room.players.length)} />;
}

/** why the host cannot start yet (the host server checks the same rules) */
function startBlocker(room: RoomState): string | null {
  if (room.players.length < NET.MIN_PLAYERS) return t('lobby.needPlayers', { n: NET.MIN_PLAYERS });
  const offline = room.players.filter((p) => p.status !== 'online');
  if (offline.length) return t('lobby.needReady', { names: offline.map((p) => p.name).join(', ') });
  const waiting = room.players.filter((p) => !p.ready);
  if (waiting.length) return t('lobby.needReady', { names: waiting.map((p) => p.name).join(', ') });
  const laggy = room.players.filter((p) => p.ping < 0 || p.ping > NET.MAX_START_PING);
  if (laggy.length) return t('lobby.badPing', { names: laggy.map((p) => p.name).join(', ') });
  return null;
}

function BottomBar({ room, isHost, ready, onClose }: { room: RoomState; isHost: boolean; ready: boolean; onClose: () => void }) {
  const blocker = isHost ? startBlocker(room) : null;
  const starting = room.status !== 'lobby';
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b0820]/85 px-4 py-3 backdrop-blur-md sm:px-8 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3">
        <div className="mr-auto min-w-0 flex-1 text-sm text-white/65">
          {starting ? (
            <span className="animate-pulse font-bold text-amber-200">{t('lobby.starting')}</span>
          ) : isHost ? (
            blocker ? <span>⏳ {blocker}</span> : <span className="font-bold text-emerald-300">✓ {t('lobby.allReady')}</span>
          ) : (
            <span>{t('lobby.waitHost')}</span>
          )}
        </div>
        {isHost ? (
          <>
            <button onClick={onClose} className="btn-ghost !py-2 text-sm">
              {t('lobby.close')}
            </button>
            <button onClick={() => net.start()} disabled={!!blocker || starting} className="btn-primary text-base sm:!px-8 sm:text-xl">
              {t('lobby.start')}
            </button>
          </>
        ) : (
          <button
            onClick={() => net.setReady(!ready)}
            disabled={starting}
            className={ready ? 'btn-ghost text-base sm:text-lg' : 'btn-primary text-base sm:!px-8 sm:text-xl'}
          >
            {ready ? t('lobby.unready') : t('lobby.readyBtn')}
          </button>
        )}
      </div>
    </div>
  );
}

function ConnChip({ conn, rtt }: { conn: string; rtt: number }) {
  if (conn === 'reconnecting') {
    return <span className="animate-pulse rounded-full bg-amber-400/25 px-3 py-1 text-xs font-bold text-amber-100 ring-1 ring-amber-300/40">{t('lobby.reconnecting')}</span>;
  }
  return <PingBadge ms={rtt} />;
}

function InviteHint() {
  const w = useRooms();
  // the room may live on another computer than the one this page came from
  const host = net.host;
  const address = !host || host === serviceHost() ? shareAddress(w.self) : host;
  return (
    <div className="space-y-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-white/60 ring-1 ring-white/10">
      <div>📶 {t('lobby.invite')}</div>
      {address && <LanAddress address={address} />}
    </div>
  );
}

function WarnToast({ code, detail, id }: { code: string; detail?: string; id: number }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      net.dismissWarn();
    }, 4000);
    return () => clearTimeout(timer);
  }, [id]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <div className="animate-pop rounded-2xl bg-rose-600/90 px-4 py-2 text-sm font-bold ring-1 ring-white/30">
        {errorText(code as never, detail)}
      </div>
    </div>
  );
}

