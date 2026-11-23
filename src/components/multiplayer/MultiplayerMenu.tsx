import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenShell, TopBar } from '../ui';
import { DEFAULT_SETTINGS, ErrorModal, RoomSettingsForm, matchLabel, playerName, profileFromSave } from './common';
import { THEMES, getMap } from '../../data/maps';
import { GAME_VERSION, NET } from '../../net/config';
import { createUrl, lanMode, probeHost, roomUrl, rooms, useRooms } from '../../net/lanService';
import { DESKTOP_LAN_LINK, INSTALLER_URL, RELEASES_URL, desktopApi, takeJoinHost, useDesktopLan } from '../../net/desktop';
import { net, savedSession, useNet } from '../../net/session';
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

export default function MultiplayerMenu({ save, update, onBack, onLobby }: Props) {
  useLang();
  const [tab, setTab] = useState<'find' | 'create'>('find');
  const view = useNet();
  const [canRejoin, setCanRejoin] = useState(() => !!savedSession());
  const mode = lanMode();

  if (mode === 'unsupported') {
    return (
      <ScreenShell>
        <TopBar title={t('mp.title')} onBack={onBack} />
        <DesktopRequired />
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
        {canRejoin && (
          <div className="flex animate-slideUp flex-wrap items-center justify-between gap-3 rounded-2xl bg-sky-500/15 px-4 py-3 ring-1 ring-sky-300/40">
            <span className="font-bold">🔄 {t('mp.rejoin')}</span>
            <div className="flex gap-2">
              <button className="btn-ghost !py-1.5 text-sm" onClick={() => setCanRejoin(false)}>
                {t('mp.cancel')}
              </button>
              <button
                className="btn-primary !py-1.5 text-sm"
                onClick={() => {
                  if (net.resumeSaved()) onLobby();
                  else setCanRejoin(false);
                }}
              >
                {t('mp.rejoinBtn')}
              </button>
            </div>
          </div>
        )}

        <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
          <label htmlFor="mp-name" className="text-xs font-bold uppercase tracking-wider text-white/60 sm:w-40">
            {t('mp.yourName')}
          </label>
          <input
            id="mp-name"
            value={save.netName}
            maxLength={16}
            placeholder={t('mp.defaultName')}
            onChange={(e) => {
              const v = e.target.value;
              update((s) => ({ ...s, netName: v }));
            }}
            className="flex-1 rounded-2xl bg-white/10 px-4 py-2.5 font-display text-lg outline-none ring-1 ring-white/15 placeholder:text-white/35 focus:ring-2 focus:ring-pink-400"
          />
        </section>

        {mode === 'desktop' && <LanServerPanel />}

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

/**
 * Web version (HTTPS, e.g. Netlify): a browser page cannot host or discover LAN games.
 * "Open" hands over to the installed desktop app through its rmrrace:// protocol (the browser
 * asks the player first); without the app the player downloads the installer from GitHub Releases.
 */
function DesktopRequired() {
  const [tried, setTried] = useState<'no' | 'waiting' | 'opened' | 'missing'>('no');
  const open = () => {
    setTried('waiting');
    let left = false;
    // the page loses focus / gets hidden when the browser hands the link to the app (or shows its prompt)
    const mark = () => {
      left = true;
    };
    window.addEventListener('blur', mark, { once: true });
    document.addEventListener('visibilitychange', mark, { once: true });
    window.location.href = DESKTOP_LAN_LINK;
    window.setTimeout(() => {
      window.removeEventListener('blur', mark);
      document.removeEventListener('visibilitychange', mark);
      setTried(left ? 'opened' : 'missing');
    }, 2500);
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-16 sm:px-8">
      <section className="panel relative animate-slideUp space-y-5 overflow-hidden p-6 text-center sm:p-10">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-sky-500/25 blur-3xl" />
        <div className="relative text-6xl">🖥️</div>
        <h2 className="relative font-display text-3xl uppercase">{t('mp.desktopRequired')}</h2>
        <p className="relative mx-auto max-w-xl text-white/75">{t('mp.desktopRequiredText')}</p>
        <div className="relative grid gap-3 sm:grid-cols-2">
          <button onClick={open} className="btn-primary w-full text-base sm:text-lg">
            🚀 {t('mp.openDesktop')}
          </button>
          <a href={INSTALLER_URL} className={`${tried === 'missing' ? 'btn-primary animate-pulse' : 'btn-ghost'} w-full text-base sm:text-lg`}>
            ⬇ {t('mp.download')}
          </a>
        </div>
        {tried === 'waiting' && <p className="relative text-sm text-sky-200">{t('mp.openWaiting')}</p>}
        {tried === 'opened' && <p className="relative text-sm text-emerald-300">✓ {t('mp.openOk')}</p>}
        {tried === 'missing' && <p className="relative text-sm text-amber-200">{t('mp.openMissing')}</p>}
        <p className="relative text-xs text-white/50">
          {t('mp.downloadHint')} ·{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline hover:text-white">
            GitHub Releases
          </a>
        </p>
      </section>
      <section className="panel space-y-2 p-5 text-sm text-white/70">
        <div className="font-display text-base text-white">{t('mp.howTitle')}</div>
        <p>1. {t('mp.how1')}</p>
        <p>2. {t('mp.how2')}</p>
        <p>3. {t('mp.how3')}</p>
      </section>
      <section className="panel space-y-2 p-5 text-sm text-white/70">
        <div className="font-display text-base text-white">{t('mp.whyDesktop')}</div>
        <p>• {t('mp.why1')}</p>
        <p>• {t('mp.why2')}</p>
        <p>• {t('mp.why3')}</p>
      </section>
    </div>
  );
}

/** desktop: the LAN server of this computer — status, address for the others, start / stop */
function LanServerPanel() {
  const info = useDesktopLan();
  const [busy, setBusy] = useState(false);
  const api = desktopApi();
  const toggle = async () => {
    if (!api || !info) return;
    setBusy(true);
    try {
      if (info.running) {
        net.leave();
        await api.stopLan();
      } else await api.startLan();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel flex flex-wrap items-center gap-3 p-4 sm:p-5">
      <span className={`h-3 w-3 shrink-0 rounded-full ${info?.running ? 'animate-pulse bg-emerald-400' : 'bg-rose-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="font-display text-base">
          {t('mp.server.title')}: {info?.running ? t('mp.server.running') : t('mp.server.stopped')}
        </div>
        {info?.running ? (
          <div className="text-xs text-white/60">
            {info.primary ? (
              <>
                {t('mp.server.address')} <code className="rounded bg-white/10 px-1.5 py-0.5 text-white/85">{info.primary}:{info.port}</code>
              </>
            ) : (
              t('mp.server.noNetwork')
            )}
            {!info.discovery && <span className="ml-2 text-amber-200">· {t('mp.discoveryOff')}</span>}
            {info.interfaces.length > 1 && (
              <span className="ml-2 text-white/40">({info.interfaces.map((i) => `${i.name}: ${i.address}`).join(' · ')})</span>
            )}
          </div>
        ) : (
          info?.error && <div className="text-xs text-rose-300">{t('mp.server.error', { e: info.error })}</div>
        )}
      </div>
      <button onClick={() => void toggle()} disabled={busy || !info} className={info?.running ? 'btn-ghost !py-2 text-sm' : 'btn-primary !py-2 text-sm'}>
        {info?.running ? t('mp.server.stop') : t('mp.server.start')}
      </button>
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
      <span className="hidden sm:inline">{t(`mp.service.${w.state}`)}</span>
    </span>
  );
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

  const search = async () => {
    if (!ip.trim()) return;
    const target = ip;
    setProbe({ busy: true, rooms: [], error: null });
    try {
      const list = await probeHost(target);
      setProbe({ busy: false, rooms: list, error: list.length ? null : t('mp.ipNoRooms', { ip: target }) });
    } catch {
      setProbe({ busy: false, rooms: [], error: t('mp.ipFail', { ip: target }) });
    }
  };
  // a host handed over by a deep link is searched right away
  const autoSearched = useRef(false);
  useEffect(() => {
    if (ip && !autoSearched.current) {
      autoSearched.current = true;
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <p className="mt-1 text-sm text-white/75">{lanMode() === 'desktop' ? t('mp.serviceOfflineDesktop') : t('mp.serviceOfflineHint')}</p>
        </div>
      )}
      {w.state === 'online' && w.self && !w.self.discovery && (
        <div className="rounded-2xl bg-amber-400/10 px-4 py-2 text-sm text-amber-100 ring-1 ring-amber-300/30">{t('mp.discoveryOff')}</div>
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
            <div className="mt-1 text-xs font-bold uppercase tracking-widest text-sky-300">{t('mp.discoveryActive')}</div>
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
            void search();
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

      {w.self && w.self.addresses.length > 0 && (
        <p className="text-center text-xs text-white/45">
          {t('mp.devices')}{' '}
          {w.self.addresses.map((a) => (
            <code key={a} className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-white/75">
              http://{a}:{w.self!.port}
            </code>
          ))}
        </p>
      )}

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
          {lanMode() === 'desktop' ? t('mp.serviceOfflineDesktop') : t('mp.serviceOfflineHint')}
        </p>
      )}
      <button onClick={create} disabled={w.state !== 'online'} className="btn-primary w-full text-lg">
        {t('mp.createBtn')}
      </button>
    </section>
  );
}
