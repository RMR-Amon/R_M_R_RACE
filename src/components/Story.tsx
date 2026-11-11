import { useState } from 'react';
import { CoinBadge, ScreenShell, TopBar } from './ui';
import { BOSSES, STORY, bossName, chapterText, chapterTitle, type StoryLevel } from '../data/story';
import { THEMES, getMap, mapName } from '../data/maps';
import { getCar } from '../data/cars';
import { fmtNum, t, useLang } from '../i18n';
import type { SaveData } from '../store/save';

interface Props {
  save: SaveData;
  onBack: () => void;
  onPlay: (level: StoryLevel) => void;
}

const MEDAL = ['🥇', '🥈', '🥉'];

export default function Story({ save, onBack, onPlay }: Props) {
  useLang();
  const next = Math.min(100, save.storyDone + 1);
  const [sel, setSel] = useState(next);
  const [chapter, setChapter] = useState(Math.ceil(next / 10));
  const level = STORY[sel - 1];
  const unlocked = (n: number) => n <= save.storyDone + 1;
  const boss = level.duel ? BOSSES[level.chapter - 1] : null;
  const map = getMap(level.mapId);

  return (
    <ScreenShell>
      <TopBar title={t('story.title')} onBack={onBack} right={<CoinBadge coins={save.coins} />} />
      <div className="mx-auto max-w-7xl space-y-5 px-4 pb-10 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-500" style={{ width: `${save.storyDone}%` }} />
          </div>
          <span className="text-sm font-bold text-white/70">{t('story.progress', { n: save.storyDone })}</span>
        </div>

        {/* chapter tabs */}
        <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((c) => {
            const open = unlocked((c - 1) * 10 + 1);
            return (
              <button
                key={c}
                disabled={!open}
                onClick={() => setChapter(c)}
                className={`shrink-0 rounded-2xl px-4 py-2 text-left ring-2 transition disabled:opacity-35 ${
                  chapter === c ? 'bg-white/15 ring-pink-400' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">{t('story.chapter', { n: c })}</div>
                <div className="font-display text-sm">{open ? chapterTitle(c) : '🔒'}</div>
              </button>
            );
          })}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <section className="panel p-5">
            <h2 className="font-display text-2xl sm:text-3xl">
              {t('story.chapter', { n: chapter })}: {chapterTitle(chapter)}
            </h2>
            <p className="mt-2 text-white/70">{chapterText(chapter)}</p>
            <div className="mt-5 grid grid-cols-5 gap-2.5">
              {STORY.slice((chapter - 1) * 10, chapter * 10).map((lv) => {
                const open = unlocked(lv.n);
                const best = save.storyBest[lv.n];
                const done = lv.n <= save.storyDone;
                return (
                  <button
                    key={lv.n}
                    disabled={!open}
                    onClick={() => setSel(lv.n)}
                    title={open ? undefined : t('story.locked')}
                    className={`relative aspect-square rounded-2xl font-display text-lg ring-2 transition disabled:opacity-35 sm:text-2xl ${
                      sel === lv.n
                        ? 'bg-gradient-to-b from-orange-400 to-rose-600 ring-white'
                        : lv.duel
                          ? 'bg-fuchsia-600/30 ring-fuchsia-400/60 hover:bg-fuchsia-600/45'
                          : done
                            ? 'bg-emerald-500/20 ring-emerald-400/50 hover:bg-emerald-500/30'
                            : 'bg-white/5 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    {open ? lv.n : '🔒'}
                    {lv.duel && <span className="absolute -right-1 -top-1 text-base">⚔️</span>}
                    {best && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-sm">{MEDAL[best - 1] ?? '🏁'}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={`panel overflow-hidden ${level.duel ? 'ring-2 ring-fuchsia-400/70' : ''}`}>
            <div className={`bg-gradient-to-br p-5 ${THEMES[map.theme].gradient}`}>
              <div className="text-xs font-black uppercase tracking-widest text-white/80 text-outline">
                {t('story.chapter', { n: level.chapter })} · {chapterTitle(level.chapter)}
              </div>
              <div className="font-display text-3xl text-outline">{t('story.level', { n: level.n })}</div>
              {level.duel && <div className="mt-1 inline-block rounded-full bg-black/50 px-3 py-0.5 font-display text-sm">{t('story.duel')}</div>}
            </div>
            <div className="space-y-2 p-5 text-white/80">
              <div>
                {THEMES[map.theme].emoji} <b>{mapName(map)}</b>
              </div>
              {boss && (
                <div>
                  👤 {t('story.boss', { name: bossName(level.chapter) })} · {getCar(boss.carId).name}
                </div>
              )}
              <div>🏁 {t('story.laps', { n: level.laps })}</div>
              <div>🚗 {t('story.rivals', { n: level.opponents })}</div>
              <div>🤖 {t(`diff.${level.difficulty}`)}</div>
              {!level.items && <div>🚫 {t('story.noItems')}</div>}
              <div className="font-bold text-amber-200">🎯 {level.duel ? t('story.goalDuel') : t('story.goal', { n: level.needPlace })}</div>
              <div className="text-amber-300">🪙 {t('story.reward', { n: fmtNum(level.reward) })}</div>
              <button disabled={!unlocked(level.n)} onClick={() => onPlay(level)} className="btn-primary mt-3 w-full text-lg sm:text-xl">
                ▶ {t('story.play')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </ScreenShell>
  );
}
