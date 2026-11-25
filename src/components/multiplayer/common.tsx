import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Choice, TrackThumb } from '../ui';
import { ARENA_MAP, RACE_MAPS, THEMES, getMap, mapName, themeName } from '../../data/maps';
import { getCar } from '../../data/cars';
import { NET } from '../../net/config';
import { t, type TKey } from '../../i18n';
import type { Profile, RoomSettings } from '../../net/protocol';
import type { NetFatal, Notice } from '../../net/session';
import type { SaveData } from '../../store/save';
import type { ThemeId } from '../../game/types';

export const DEFAULT_SETTINGS: RoomSettings = {
  name: '',
  maxPlayers: 4,
  mode: 'race',
  mapId: RACE_MAPS[0].id,
  theme: 'city',
  laps: 3,
  minutes: 3,
  items: true,
  private: false,
};

export const playerName = (save: SaveData) => save.netName.trim() || t('mp.defaultName');

/** what other players see of us: name, car, paint and driver */
export function profileFromSave(save: SaveData): Profile {
  return {
    name: playerName(save),
    carId: save.selectedCar,
    paint: save.paints[save.selectedCar] ?? null,
    look: save.driver,
  };
}

export function errorText(code: NetFatal, detail?: string) {
  return t(`err.${code}` as TKey, { detail: detail ?? '' });
}

export function matchLabel(s: { mode: 'race' | 'battle'; mapId: string; theme: ThemeId; laps: number; minutes: number }) {
  if (s.mode === 'battle') return `⚔️ ${mapName(ARENA_MAP)} · ${themeName(s.theme)} · ${t('setup.min', { n: s.minutes })}`;
  return `🏁 ${mapName(getMap(s.mapId))} · ${t('res.laps', { n: s.laps })}`;
}

export function PingBadge({ ms }: { ms: number }) {
  if (ms < 0) return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/50">— ms</span>;
  const tone = ms < 60 ? 'bg-emerald-400/20 text-emerald-300 ring-emerald-400/40' : ms <= NET.MAX_START_PING ? 'bg-amber-400/20 text-amber-200 ring-amber-300/40' : 'bg-rose-500/25 text-rose-200 ring-rose-400/50';
  const bars = ms < 60 ? 3 : ms <= NET.MAX_START_PING ? 2 : 1;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ${tone}`}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((b) => (
          <span key={b} className={`w-[3px] rounded-sm ${b <= bars ? 'bg-current' : 'bg-white/20'}`} style={{ height: 3 + b * 3 }} />
        ))}
      </span>
      {t('lobby.ping', { ms })}
    </span>
  );
}

/** round avatar in the car's colours with the driver's helmet colour and the initial */
export function Avatar({ profile, size = 44 }: { profile: Profile; size?: number }) {
  const car = getCar(profile.carId);
  const color = profile.paint?.color ?? car.color;
  const accent = profile.paint?.accent ?? car.accent;
  const initial = Array.from(profile.name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-2xl font-display text-white ring-2 ring-white/20 shadow-lg"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${accent})`, fontSize: size * 0.42 }}
    >
      <span className="text-outline">{initial}</span>
      <span
        className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-[#0b0820]"
        style={{ width: size * 0.36, height: size * 0.36, background: profile.look.helmet }}
        aria-hidden
      />
    </span>
  );
}

/** short-lived toasts for lobby / room notices */
export function NoticeToasts({ notices }: { notices: Notice[] }) {
  const [visible, setVisible] = useState<Notice[]>([]);
  // every toast has its own timer: a newer notice must not cancel the older one's
  const timers = useRef(new Map<number, number>());
  useEffect(() => {
    const last = notices[notices.length - 1];
    if (!last || timers.current.has(last.id)) return;
    setVisible((v) => [...v.slice(-2), last]);
    timers.current.set(
      last.id,
      window.setTimeout(() => setVisible((v) => v.filter((x) => x.id !== last.id)), 3500),
    );
  }, [notices]);
  useEffect(() => {
    const all = timers.current;
    return () => {
      all.forEach((id) => clearTimeout(id));
      all.clear();
    };
  }, []);
  if (!visible.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4">
      {visible.map((n) => (
        <div key={n.id} className="animate-pop rounded-2xl bg-black/70 px-4 py-2 text-sm font-bold ring-1 ring-white/20 backdrop-blur">
          {t(`notice.${n.key}` as TKey, { name: n.name ?? '' })}
        </div>
      ))}
    </div>
  );
}

export function ErrorModal({ code, detail, onClose }: { code: NetFatal; detail?: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel w-full max-w-sm animate-pop space-y-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-5xl">📡</div>
        <h2 className="font-display text-2xl">{t('err.title')}</h2>
        <p className="text-white/80">{errorText(code, detail)}</p>
        <button onClick={onClose} className="btn-primary w-full">
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">{children}</h3>
);

/** room settings: used to create a room and by the host in the lobby */
export function RoomSettingsForm({
  value,
  onChange,
  minPlayers = NET.MIN_PLAYERS,
  disabled = false,
  compact = false,
}: {
  value: RoomSettings;
  onChange: (s: RoomSettings) => void;
  minPlayers?: number;
  disabled?: boolean;
  compact?: boolean;
}) {
  const set = (patch: Partial<RoomSettings>) => onChange({ ...value, ...patch });
  return (
    <fieldset disabled={disabled} className={`space-y-5 ${disabled ? 'opacity-70' : ''}`}>
      <section>
        <Label>{t('mp.roomName')}</Label>
        <input
          value={value.name}
          maxLength={24}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={t('mp.roomNamePlaceholder')}
          className="w-full rounded-2xl bg-white/10 px-4 py-2.5 font-bold outline-none ring-1 ring-white/15 placeholder:text-white/35 focus:ring-2 focus:ring-pink-400"
        />
      </section>

      <section>
        <Label>{t('mp.mode')}</Label>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['race', t('mode.race'), t('mode.raceSub')],
              ['battle', t('mode.battle'), t('mode.battleSub')],
            ] as const
          ).map(([id, title, sub]) => (
            <button
              type="button"
              key={id}
              onClick={() => set({ mode: id, items: id === 'battle' ? true : value.items })}
              className={`rounded-2xl p-3 text-left ring-2 transition ${
                value.mode === id ? 'bg-gradient-to-br from-pink-500/30 to-violet-600/30 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
              }`}
            >
              <div className="font-display text-lg">{title}</div>
              {!compact && <div className="text-xs text-white/60">{sub}</div>}
            </button>
          ))}
        </div>
      </section>

      {value.mode === 'race' ? (
        <section>
          <Label>{t('mp.map')}</Label>
          <div className={`grid gap-3 ${compact ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
            {RACE_MAPS.map((m) => {
              const th = THEMES[m.theme];
              const active = m.id === value.mapId;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => set({ mapId: m.id, theme: m.theme })}
                  className={`overflow-hidden rounded-2xl text-left ring-4 transition ${active ? 'ring-white' : 'ring-transparent hover:ring-white/30'}`}
                >
                  <div className={`relative ${compact ? 'h-14' : 'h-20'} bg-gradient-to-br ${th.gradient}`}>
                    <TrackThumb map={m} className="absolute inset-1.5 h-[calc(100%-12px)] w-[calc(100%-12px)] opacity-90" />
                    <span className="absolute left-1.5 top-1 text-lg drop-shadow">{th.emoji}</span>
                  </div>
                  <div className="truncate bg-black/40 px-2 py-1 font-display text-xs">{mapName(m)}</div>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section>
          <Label>{t('setup.arenaTheme')}</Label>
          <div className="flex flex-wrap gap-2">
            {Object.values(THEMES).map((th) => (
              <button
                type="button"
                key={th.id}
                onClick={() => set({ theme: th.id })}
                className={`flex items-center gap-2 rounded-2xl bg-gradient-to-br px-3 py-2 font-bold ring-4 transition ${th.gradient} ${
                  value.theme === th.id ? 'ring-white' : 'ring-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <span className="text-xl">{th.emoji}</span>
                <span className="text-outline text-sm">{themeName(th.id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <section>
          <Label>{t('mp.maxPlayers')}</Label>
          <Choice
            value={value.maxPlayers}
            onPick={(n) => set({ maxPlayers: n })}
            options={[2, 3, 4, 5, 6, 7, 8].filter((n) => n >= minPlayers).map((n) => ({ id: n, label: n }))}
          />
        </section>
        {value.mode === 'race' ? (
          <section>
            <Label>{t('setup.laps')}</Label>
            <Choice value={value.laps} onPick={(n) => set({ laps: n })} options={[1, 2, 3, 4, 5].map((n) => ({ id: n, label: n }))} />
          </section>
        ) : (
          <section>
            <Label>{t('setup.duration')}</Label>
            <Choice value={value.minutes} onPick={(n) => set({ minutes: n })} options={[1, 2, 3, 5, 7, 10].map((n) => ({ id: n, label: t('setup.min', { n }) }))} />
          </section>
        )}
        <section>
          <Label>{t('setup.items')}</Label>
          <Choice
            value={value.items || value.mode === 'battle' ? 'on' : 'off'}
            onPick={(v) => set({ items: value.mode === 'battle' || v === 'on' })}
            options={[
              { id: 'on', label: `📦 ${t('common.on')}` },
              ...(value.mode === 'battle' ? [] : [{ id: 'off' as const, label: t('common.off') }]),
            ]}
          />
        </section>
        <section>
          <Label>{t('mp.access')}</Label>
          <Choice
            value={value.private ? 'private' : 'public'}
            onPick={(v) => set({ private: v === 'private' })}
            options={[
              { id: 'public', label: `🌐 ${t('mp.public')}` },
              { id: 'private', label: `🔒 ${t('mp.private')}` },
            ]}
          />
          {value.private && <p className="mt-2 text-xs text-white/55">{t('mp.privateHint')}</p>}
        </section>
      </div>
    </fieldset>
  );
}
