import { useEffect, useMemo, useState } from 'react';
import { ScreenShell, TopBar } from '../ui';
import { DEFAULT_SETTINGS, ErrorModal, NameField, RejoinBar, RoomSettingsForm, matchLabel, playerName, profileFromSave } from './common';
import { THEMES, getMap } from '../../data/maps';
import { GAME_VERSION, NET } from '../../net/config';
import { createUrl, lanMode, probeHost, roomUrl, rooms, shareAddress, useRooms } from '../../net/lanService';
import { desktopApi, takeJoinHost, useDesktopLan } from '../../net/desktop';
import { LanAddress } from './LanAddress';
import { LanGuide } from './LanGuide';
import OnlineMenu, { OnlineNotConfigured } from './OnlineMenu';
import { onlineAvailable } from '../../net/online';
import { net, useNet } from '../../net/session';
import { t, useLang } from '../../i18n';
import type { DiscoveredRoom } from '../../net/protocol';
import type { SaveData } from '../../store/save';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  onBack: () => void;
  /** a create / join / rejoin was started: show the lobby */
  onLobby: () => void;
}

/** online multiplayer on the website; local network play on pages that came from a LAN server */
export default function MultiplayerMenu(props: Props) {
  const [lan, setLan] = useState(false);
  if (onlineAvailable() && !lan) return <OnlineMenu {...props} onLan={() => setLan(true)} />;
  return <LanMenu {...props} onBack={lan ? () => setLan(false) : props.onBack} />;
}

function LanMenu({ save, update, onBack, onLobby }: Props) {
  useLang();
  const [tab, setTab] = useState<'find' | 'create'>('find');
  const view = useNet();
  const mode = lanMode();

  if (mode === 'unsupported') {
    return (
      <ScreenShell>
        <TopBar title={t('mp.title')} onBack={onBack} />
        {!onlineAvailable() && <OnlineNotConfigured />}
        <LanGuide />
      </ScreenShell>
    );
  }

  const join = (room: DiscoveredRoom, code?: string) => {
    net.join(roomUrl(room), room.roomId, profileFromSave(save), code);
    onLobby();
  };

  return (
    <ScreenShell>
      <TopBar title={t('mp.title')} onBack={onBack} right={<ServiceBadge />} />
      <div className="mx-auto max-w-6xl space-y-5 px-4 pb-16 sm:px-8">
        <RejoinBar onLobby={onLobby} />

        <NameField save={save} update={update} />

        <LanServerPanel />

        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['create', '🏗️', t('mp.create'), t('mp.createSub')],
              ['find', '📡', t('mp.find'), t('mp.findSub')],
            ] as const
          ).map(([id, icon, title, sub]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`group rounded-3xl p-4 text-left ring-2 transition sm:p-6 ${
                tab === id ? 'bg-gradient-to-br from-orange-500/30 to-rose-600/30 ring-orange-300' : 'bg-white/5 ring-white/10 hover:bg-white/10'
              }`}
            >
              <div className="text-3xl transition group-hover:scale-110 sm:text-4xl">{icon}</div>
              <div className="mt-1 font-display text-lg uppercase sm:text-2xl">{title}</div>
              <div className="text-xs text-white/60 sm:text-sm">{sub}</div>
            </button>
          ))}
        </div>

        {tab === 'find' ? <FindRooms onJoin={join} /> : <CreateRoom save={save} onCreated={onLobby} />}
      </div>

      {view.phase === 'ended' && view.fatal && <ErrorModal code={view.fatal.code} detail={view.fatal.detail} onClose={() => net.dismiss()} />}
    </ScreenShell>
  );
}

/** the LAN server this page is connected to: real status, address for the players, who is here */
function LanServerPanel() {
  const w = useRooms();
  const desk = useDesktopLan();
  const api = desktopApi();
  const [busy, setBusy] = useState(false);
  const online = w.state === 'online';
  const self = online ? w.self : null;
  const address = shareAddress(self);
  // only the optional desktop app can start / stop the server from the game
  const toggle = async () => {
    if (!api || !desk) return;
    setBusy(true);
    try {
      if (desk.running) {
        net.leave();
        await api.stopLan();
      } else await api.startLan();
    } finally {
      setBusy(false);
    }
  };
  const status = online ? t('mp.server.running') : w.state === 'connecting' ? t('mp.service.connecting') : api ? t('mp.server.stopped') : t('mp.server.lost');
  const others = self ? self.interfaces.filter((i) => `${i.address}:${self.port}` !== address) : [];
  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-3 w-3 shrink-0 rounded-full ${online ? 'animate-pulse bg-emerald-400' : w.state === 'connecting' ? 'bg-amber-300' : 'bg-rose-400'}`} />
        <div className="min-w-0 flex-1 font-display text-base">
          {t('mp.server.title')}: {status}
        </div>
        {self && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
            👥 {t('mp.server.players', { n: self.players })} · 🏁 {t('mp.server.rooms', { n: self.roomCount })}
          </span>
        )}
        {api && (
          <button onClick={() => void toggle()} disabled={busy || !desk} className={desk?.running ? 'btn-ghost !py-2 text-sm' : 'btn-primary !py-2 text-sm'}>
            {desk?.running ? t('mp.server.stop') : t('mp.server.start')}
          </button>
        )}
      </div>
      {self &&
        (address ? (
          <>
            <p className="text-sm text-white/65">{t('mp.server.address')}</p>
            <LanAddress address={address} />
            {others.length > 0 && (
              <p className="text-xs text-white/45">
                {t('mp.server.other')} {others.map((i) => `${i.name}: ${i.address}:${self.port}`).join(' · ')}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-amber-200">{t('mp.server.noNetwork')}</p>
        ))}
      {self && !self.discovery && <p className="text-sm text-amber-200">{t('mp.discoveryOff')}</p>}
      {!online && desk?.error && <p className="text-sm text-rose-300">{t('mp.server.error', { e: desk.error })}</p>}
    </section>
  );
}

function ServiceBadge() {
  const w = useRooms();
  const cls =
    w.state === 'online'
      ? 'bg-emerald-400/20 text-emerald-200 ring-emerald-400/40'
      : w.state === 'offline'
        ? 'bg-rose-500/20 text-rose-200 ring-rose-400/40'
        : 'bg-white/10 text-white/70 ring-white/20';
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${w.state === 'online' ? 'animate-pulse bg-emerald-400' : w.state === 'offline' ? 'bg-rose-400' : 'bg-white/60'}`} />
      {t(`mp.service.${w.state}`)}
    </span>
  );
}

/** what to do when the LAN server does not answer depends on where this page came from */
function offlineHint() {
  const mode = lanMode();
  return mode === 'desktop' ? t('mp.serviceOfflineDesktop') : mode === 'served' ? t('mp.serverLostHint') : t('mp.serviceOfflineHint');
}

function FindRooms({ onJoin }: { onJoin: (r: DiscoveredRoom, code?: string) => void }) {
  const w = useRooms();
  const [spin, setSpin] = useState(false);
  // rmrrace://join?host=… hands over a host to connect to
  const [ip, setIp] = useState(() => takeJoinHost() ?? '');
  const [probe, setProbe] = useState<{ busy: boolean; rooms: DiscoveredRoom[]; error: string | null }>({ busy: false, rooms: [], error: null });
  const [askCode, setAskCode] = useState<DiscoveredRoom | null>(null);

  const refresh = () => {
    rooms.refresh();
    setSpin(true);
    window.setTimeout(() => setSpin(false), 700);
  };

  // the host given by address; its rooms are refreshed like the discovered ones
  const [target, setTarget] = useState(() => ip.trim());
  const search = () => {
    const next = ip.trim();
    if (!next) return;
    setProbe({ busy: true, rooms: [], error: null });
    setTarget('');
    // a new value restarts the polling even when the address is the same
    window.setTimeout(() => setTarget(next), 0);
  };
  useEffect(() => {
    if (!target) return;
    let alive = true;
    let timer = 0;
    const poll = async () => {
      let next: typeof probe;
      try {
        const list = await probeHost(target);
        next = { busy: false, rooms: list, error: list.length ? null : t('mp.ipNoRooms', { ip: target }) };
      } catch {
        next = { busy: false, rooms: [], error: t('mp.ipFail', { ip: target }) };
      }
      if (!alive) return;
      setProbe(next);
      timer = window.setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target]);

  // rooms found by IP are merged with the LAN list (without duplicates)
  const list = useMemo(() => {
    const seen = new Set(w.rooms.map((r) => r.sid + r.roomId));
    return [...w.rooms, ...probe.rooms.filter((r) => !seen.has(r.sid + r.roomId))];
  }, [w.rooms, probe.rooms]);

  const pick = (r: DiscoveredRoom) => (r.private ? setAskCode(r) : onJoin(r));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-lg uppercase tracking-wider text-white/80">
          {t('mp.rooms')} <span className="text-white/50">({list.length})</span>
        </h2>
        <button onClick={refresh} className="btn-ghost !py-2 text-sm">
          <span className={spin ? 'inline-block animate-spin' : 'inline-block'}>🔄</span> {t('mp.refresh')}
        </button>
      </div>

      {(w.state === 'offline' || w.state === 'stopped') && (
        <div className="animate-slideUp rounded-3xl bg-rose-500/10 p-5 ring-1 ring-rose-400/40">
          <div className="font-display text-xl">⚠️ {t('mp.serviceOffline')}</div>
          <p className="mt-1 text-sm text-white/75">{offlineHint()}</p>
        </div>
      )}

      {list.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r, i) => (
            <RoomCard key={r.sid + r.roomId} room={r} index={i} onJoin={() => pick(r)} />
          ))}
        </div>
      ) : (
        w.state === 'online' && (
          <div className="panel animate-slideUp p-6 text-center sm:p-10">
            <div className="relative mx-auto mb-3 grid h-20 w-20 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/20" />
              <span className="absolute inset-3 animate-ping rounded-full bg-sky-400/20 [animation-delay:400ms]" />
              <span className="relative text-4xl">📡</span>
            </div>
            <div className="font-display text-2xl">{t('mp.noRooms')}</div>
            {w.self?.discovery && <div className="mt-1 text-xs font-bold uppercase tracking-widest text-sky-300">{t('mp.discoveryActive')}</div>}
            <p className="mx-auto mt-1 max-w-md text-sm text-white/60">{t('mp.noRoomsHint')}</p>
            <ul className="mx-auto mt-4 max-w-lg space-y-1.5 text-left text-xs text-white/55 sm:text-sm">
              <li>📶 {t('mp.tip1')}</li>
              <li>🔓 {t('mp.tip2')}</li>
              <li>🛡️ {t('mp.tip3')}</li>
              <li>⌨️ {t('mp.tip4')}</li>
            </ul>
          </div>
        )
      )}

      <div className="panel space-y-2 p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-white/60">{t('mp.byIp')}</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder={`192.168.1.20:${NET.HTTP_PORT}`}
            inputMode="url"
            className="min-w-0 flex-1 rounded-2xl bg-white/10 px-4 py-2 font-mono outline-none ring-1 ring-white/15 placeholder:text-white/30 focus:ring-2 focus:ring-sky-400"
          />
          <button type="submit" className="btn-ghost !py-2 text-sm" disabled={probe.busy}>
            {probe.busy ? '…' : t('mp.search')}
          </button>
        </form>
        {probe.error && <p className="text-sm text-rose-300">{probe.error}</p>}
      </div>

      {askCode && <CodePrompt onCancel={() => setAskCode(null)} onEnter={(code) => onJoin(askCode, code)} />}
    </section>
  );
}

function RoomCard({ room, index, onJoin }: { room: DiscoveredRoom; index: number; onJoin: () => void }) {
  const full = room.players >= room.max;
  const busy = room.status !== 'lobby';
  const th = THEMES[room.mode === 'battle' ? room.theme : getMap(room.mapId).theme];
  const w = useRooms();
  void w; // re-render when reachability checks arrive
  const check = rooms.check(room);
  const unreachable = !!check && !check.ok;
  const disabled = full || busy || !room.compatible || unreachable;
  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
      className="group flex animate-slideUp overflow-hidden rounded-3xl bg-white/[0.06] ring-1 ring-white/10 transition hover:ring-white/30"
    >
      <div className={`grid w-16 shrink-0 place-items-center bg-gradient-to-b text-3xl sm:w-20 ${th.gradient}`}>{th.emoji}</div>
      <div className="min-w-0 flex-1 space-y-1 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-lg">{room.name}</span>
          {room.private && <span title={t('mp.private')}>🔒</span>}
        </div>
        <div className="truncate text-xs text-white/60">
          👑 {room.hostName} · {matchLabel(room)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
          <span className={`rounded-full px-2 py-0.5 ${full ? 'bg-rose-500/30 text-rose-100' : 'bg-white/10'}`}>
            👥 {room.players}/{room.max}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${busy ? 'bg-amber-400/25 text-amber-100' : 'bg-emerald-400/20 text-emerald-200'}`}>
            {t(`mp.status.${room.status}`)}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${room.compatible ? 'bg-white/10 text-white/60' : 'bg-rose-500/25 text-rose-100'}`}>
            v{room.version}
            {!room.compatible && ` · ${t('mp.incompatible', { v: GAME_VERSION })}`}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${!check ? 'bg-white/10 text-white/50' : check.ok ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-500/25 text-rose-100'}`}
            title={room.address ? `${room.address}:${room.port}` : ''}
          >
            {!check ? t('mp.check.wait') : check.ok ? `● ${t('mp.check.ok')} · ${check.ping} ms` : `✕ ${t('mp.check.bad')}`}
          </span>
          {room.address && <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono font-normal text-white/45">{room.address}:{room.port}</span>}
        </div>
      </div>
      <div className="grid place-items-center pr-3 sm:pr-4">
        <button onClick={onJoin} disabled={disabled} className="btn-primary !px-4 !py-2 text-sm">
          {full ? t('mp.full') : t('mp.join')}
        </button>
      </div>
    </div>
  );
}

function CodePrompt({ onCancel, onEnter }: { onCancel: () => void; onEnter: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <form
        className="panel w-full max-w-xs animate-pop space-y-4 p-6 text-center"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d{4}$/.test(code)) onEnter(code);
        }}
      >
        <div className="text-4xl">🔒</div>
        <h2 className="font-display text-2xl">{t('mp.codeTitle')}</h2>
        <p className="text-sm text-white/70">{t('mp.codePrompt')}</p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          className="w-full rounded-2xl bg-white/10 py-3 text-center font-display text-3xl tracking-[0.5em] outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-pink-400"
          placeholder="••••"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            {t('mp.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={code.length !== 4}>
            {t('mp.enter')}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateRoom({ save, onCreated }: { save: SaveData; onCreated: () => void }) {
  const w = useRooms();
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, name: t('mp.roomOf', { name: playerName(save) }) }));
  // keep the default room name in step with the player name until the user edits it
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setSettings((s) => ({ ...s, name: t('mp.roomOf', { name: playerName(save) }) }));
  }, [save.netName, touched, save]);

  const create = () => {
    net.create(createUrl(), { ...settings, name: settings.name.trim() || t('mp.roomOf', { name: playerName(save) }) }, profileFromSave(save));
    onCreated();
  };

  return (
    <section className="panel animate-slideUp space-y-5 p-4 sm:p-6">
      <RoomSettingsForm
        value={settings}
        onChange={(s) => {
          if (s.name !== settings.name) setTouched(true);
          setSettings(s);
        }}
      />
      {w.state !== 'online' && (
        <p className="rounded-2xl bg-rose-500/10 px-4 py-2 text-sm text-rose-200 ring-1 ring-rose-400/30">
          {offlineHint()}
        </p>
      )}
      <button onClick={create} disabled={w.state !== 'online'} className="btn-primary w-full text-lg">
        {t('mp.createBtn')}
      </button>
    </section>
  );
}
