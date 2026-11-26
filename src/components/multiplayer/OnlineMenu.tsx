import { useEffect, useState } from 'react';
import { ScreenShell, TopBar } from '../ui';
import { DEFAULT_SETTINGS, ErrorModal, NameField, RejoinBar, RoomSettingsForm, playerName, profileFromSave } from './common';
import { CODE_LENGTH, cleanCode } from '../../net/protocol';
import { net, useNet } from '../../net/session';
import { online, onlineRoomUrl, takeInviteCode, useOnline, type OnlineView } from '../../net/online';
import { t, useLang } from '../../i18n';
import type { SaveData } from '../../store/save';

interface Props {
  save: SaveData;
  update: (fn: (s: SaveData) => SaveData) => void;
  onBack: () => void;
  onLobby: () => void;
  /** local network play (secondary) */
  onLan: () => void;
}

/** players from anywhere: Quick Play, private rooms with an invite code */
export default function OnlineMenu({ save, update, onBack, onLobby, onLan }: Props) {
  useLang();
  const o = useOnline();
  const view = useNet();
  const [invite] = useState(takeInviteCode);
  const [tab, setTab] = useState<'create' | 'join' | null>(invite ? 'join' : null);
  const [code, setCode] = useState(invite ?? '');
  const ready = o.state === 'online' && o.phase === 'idle';

  // a seat was found: take it
  useEffect(() => {
    if (!o.match) return;
    const m = online.takeMatch();
    if (!m) return;
    net.joinTicket(onlineRoomUrl(m.roomId), m.roomId, m.ticket, profileFromSave(save));
    onLobby();
  }, [o.match, save, onLobby]);

  const back = () => {
    if (o.phase !== 'idle') online.cancel();
    onBack();
  };

  return (
    <ScreenShell>
      <TopBar title={t('on.title')} onBack={back} right={<OnlineBadge o={o} />} />
      <div className="mx-auto max-w-6xl space-y-5 px-4 pb-16 sm:px-8">
        <RejoinBar onLobby={onLobby} />
        <NameField save={save} update={update} />

        {(o.state === 'offline' || o.state === 'limit') && (
          <div className="flex animate-slideUp flex-wrap items-center gap-3 rounded-3xl bg-rose-500/10 p-5 ring-1 ring-rose-400/40">
            <div className="min-w-0 flex-1">
              <div className="font-display text-xl">⚠️ {o.state === 'limit' ? t('on.limitTitle') : t('on.offlineTitle')}</div>
              <p className="mt-1 text-sm text-white/75">{o.state === 'limit' ? t('err.serviceLimit') : t('on.offlineHint')}</p>
            </div>
            <button className="btn-ghost !py-2 text-sm" onClick={() => online.reconnect()}>
              🔄 {t('on.retry')}
            </button>
          </div>
        )}

        {o.phase === 'searching' ? (
          <Searching o={o} />
        ) : (
          <>
            <button
              onClick={() => online.quickPlay()}
              disabled={!ready}
              className="group w-full rounded-3xl bg-gradient-to-br from-orange-500/40 to-rose-600/40 p-6 text-left ring-2 ring-orange-300 transition hover:brightness-125 disabled:opacity-50 sm:p-8"
            >
              <div className="flex items-center gap-4">
                <div className="text-5xl transition group-hover:scale-110 sm:text-6xl">🏁</div>
                <div className="min-w-0">
                  <div className="font-display text-2xl uppercase sm:text-4xl">{t('on.quick')}</div>
                  <div className="text-sm text-white/70 sm:text-base">{t('on.quickSub')}</div>
                </div>
              </div>
            </button>

            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['create', '🔒', t('on.create'), t('on.createSub')],
                  ['join', '🔑', t('on.join'), t('on.joinSub')],
                ] as const
              ).map(([id, icon, title, sub]) => (
                <button
                  key={id}
                  onClick={() => setTab(tab === id ? null : id)}
                  className={`group rounded-3xl p-4 text-left ring-2 transition sm:p-6 ${
                    tab === id ? 'bg-gradient-to-br from-sky-500/30 to-violet-600/30 ring-sky-300' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="text-3xl transition group-hover:scale-110 sm:text-4xl">{icon}</div>
                  <div className="mt-1 font-display text-lg uppercase sm:text-2xl">{title}</div>
                  <div className="text-xs text-white/60 sm:text-sm">{sub}</div>
                </button>
              ))}
            </div>

            {tab === 'create' && <CreatePrivate save={save} disabled={!ready} busy={o.phase === 'creating'} />}
            {tab === 'join' && (
              <form
                className="panel animate-slideUp space-y-4 p-4 sm:p-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = cleanCode(code);
                  if (c && ready) online.joinPrivate(c);
                }}
              >
                <label htmlFor="room-code" className="text-xs font-bold uppercase tracking-wider text-white/60">
                  {t('on.code')}
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    id="room-code"
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={'•'.repeat(CODE_LENGTH)}
                    className="min-w-0 flex-1 rounded-2xl bg-white/10 py-3 text-center font-display text-2xl tracking-[0.35em] outline-none ring-1 ring-white/20 placeholder:text-white/25 focus:ring-2 focus:ring-sky-400 sm:text-3xl"
                  />
                  <button type="submit" className="btn-primary text-lg" disabled={!ready || !cleanCode(code)}>
                    {o.phase === 'joining' ? t('mp.connecting') : t('on.joinBtn')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        <p className="text-center">
          <button onClick={onLan} className="text-xs text-white/45 underline-offset-4 hover:text-white/80 hover:underline">
            📶 {t('on.lanLink')}
          </button>
        </p>
      </div>

      {view.phase === 'ended' && view.fatal ? (
        <ErrorModal code={view.fatal.code} detail={view.fatal.detail} onClose={() => net.dismiss()} />
      ) : (
        o.error && <ErrorModal code={o.error.code} onClose={() => online.dismissError()} />
      )}
    </ScreenShell>
  );
}

function OnlineBadge({ o }: { o: OnlineView }) {
  const ok = o.state === 'online';
  const bad = o.state === 'offline' || o.state === 'limit';
  const cls = ok ? 'bg-emerald-400/20 text-emerald-200 ring-emerald-400/40' : bad ? 'bg-rose-500/20 text-rose-200 ring-rose-400/40' : 'bg-white/10 text-white/70 ring-white/20';
  return (
    <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ring-1 ${cls}`}>
      <span className={`h-2 w-2 rounded-full ${ok ? 'animate-pulse bg-emerald-400' : bad ? 'bg-rose-400' : 'animate-pulse bg-amber-300'}`} />
      {ok && o.players !== null ? t('on.players', { n: o.players }) : t(`on.state.${o.state}`)}
    </span>
  );
}

function Searching({ o }: { o: OnlineView }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const sec = Math.max(0, Math.floor((now - o.since) / 1000));
  return (
    <section className="panel animate-slideUp space-y-4 p-6 text-center sm:p-10">
      <div className="relative mx-auto grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-orange-400/20" />
        <span className="absolute inset-4 animate-ping rounded-full bg-orange-400/20 [animation-delay:400ms]" />
        <span className="relative text-5xl">🏎️</span>
      </div>
      <div className="font-display text-2xl uppercase sm:text-3xl">{t('on.searching')}</div>
      <div className="flex flex-wrap justify-center gap-2 text-sm font-bold">
        <span className="rounded-full bg-white/10 px-3 py-1">
          👥 {t('on.found', { n: Math.max(1, o.searching), min: o.min })}
        </span>
        <span className="rounded-full bg-white/10 px-3 py-1 tabular-nums">
          ⏱ {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}
        </span>
      </div>
      {o.state !== 'online' && <p className="text-sm text-amber-200">{t('on.state.connecting')}</p>}
      <p className="mx-auto max-w-md text-sm text-white/60">{t('on.searchHint')}</p>
      <button onClick={() => online.cancel()} className="btn-ghost">
        ✕ {t('on.cancelSearch')}
      </button>
    </section>
  );
}

function CreatePrivate({ save, disabled, busy }: { save: SaveData; disabled: boolean; busy: boolean }) {
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, private: true, name: t('mp.roomOf', { name: playerName(save) }) }));
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setSettings((s) => ({ ...s, name: t('mp.roomOf', { name: playerName(save) }) }));
  }, [save.netName, touched, save]);
  return (
    <section className="panel animate-slideUp space-y-5 p-4 sm:p-6">
      <RoomSettingsForm
        online
        value={settings}
        onChange={(s) => {
          if (s.name !== settings.name) setTouched(true);
          setSettings(s);
        }}
      />
      <button
        onClick={() => online.createPrivate({ ...settings, name: settings.name.trim() || t('mp.roomOf', { name: playerName(save) }) })}
        disabled={disabled}
        className="btn-primary w-full text-lg"
      >
        {busy ? t('mp.connecting') : t('mp.createBtn')}
      </button>
    </section>
  );
}

/** the site was built without a backend address: say so instead of pretending to search */
export function OnlineNotConfigured() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-5 sm:px-8">
      <section className="panel animate-slideUp space-y-2 p-6 text-center">
        <div className="text-5xl">🌐</div>
        <h2 className="font-display text-2xl uppercase">{t('on.title')}</h2>
        <p className="text-white/75">{t('on.notConfigured')}</p>
      </section>
    </div>
  );
}
