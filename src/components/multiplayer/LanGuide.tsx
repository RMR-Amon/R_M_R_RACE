import { useState } from 'react';
import { NET } from '../../net/config';
import { lanUrl } from '../../net/lanService';
import { t } from '../../i18n';

const LAST_KEY = 'rmr-lan-address';

const lastAddress = () => {
  try {
    return localStorage.getItem(LAST_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Shown when the game was opened from a normal website (Netlify, HTTPS). Such a page cannot see or
 * join LAN rooms, so nothing is searched or faked here: the player opens the organizer's own
 * address, which is an ordinary page navigation.
 */
export function LanGuide() {
  const [value, setValue] = useState(lastAddress);
  const [bad, setBad] = useState(false);
  const open = () => {
    const url = lanUrl(value);
    if (!url) {
      setBad(true);
      return;
    }
    try {
      localStorage.setItem(LAST_KEY, value.trim());
    } catch {
      /* storage blocked */
    }
    window.location.assign(url);
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 pb-16 sm:px-8">
      <section className="panel relative animate-slideUp space-y-5 overflow-hidden p-6 sm:p-10">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-sky-500/25 blur-3xl" />
        <div className="relative text-center">
          <div className="text-6xl">📶</div>
          <h2 className="mt-2 font-display text-2xl uppercase sm:text-3xl">{t('mp.webTitle')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-white/75">{t('mp.webText')}</p>
        </div>
        <form
          className="relative space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            open();
          }}
        >
          <label htmlFor="lan-address" className="text-xs font-bold uppercase tracking-wider text-white/60">
            {t('mp.webAddress')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="lan-address"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setBad(false);
              }}
              placeholder={`192.168.1.100:${NET.HTTP_PORT}`}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={bad}
              className={`min-w-0 flex-1 rounded-2xl bg-white/10 px-4 py-3 font-mono text-lg outline-none ring-1 placeholder:text-white/30 focus:ring-2 ${bad ? 'ring-rose-400 focus:ring-rose-400' : 'ring-white/15 focus:ring-sky-400'}`}
            />
            <button type="submit" className="btn-primary" disabled={!value.trim()}>
              {t('mp.webOpen')}
            </button>
          </div>
          {bad && <p className="text-sm text-rose-300">{t('mp.webBad')}</p>}
          <p className="text-xs text-white/50">{t('mp.webOpenHint')}</p>
        </form>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <section className="panel space-y-2 p-5 text-sm text-white/70">
          <div className="font-display text-base text-white">🎮 {t('mp.webPlayers')}</div>
          <p>1. {t('mp.webPlayer1')}</p>
          <p>2. {t('mp.webPlayer2')}</p>
          <p>3. {t('mp.webPlayer3')}</p>
        </section>
        <section className="panel space-y-2 p-5 text-sm text-white/70">
          <div className="font-display text-base text-white">👑 {t('mp.webHost')}</div>
          <p>1. {t('mp.webHost1')}</p>
          <p>
            2. {t('mp.webHost2')} <code className="select-text rounded bg-white/10 px-1.5 py-0.5 font-mono text-white/90">npm start</code>
          </p>
          <p>3. {t('mp.webHost3')}</p>
        </section>
      </div>
      <p className="text-center text-xs text-white/45">{t('mp.webWhy')}</p>
    </div>
  );
}
