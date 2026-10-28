import { useEffect, useState } from 'react';
import MainMenu from './components/MainMenu';
import Garage from './components/Garage';
import Setup, { type RaceSetup } from './components/Setup';
import Story from './components/Story';
import RaceScreen from './components/RaceScreen';
import Results from './components/Results';
import { useSave, type SaveData } from './store/save';
import { audio } from './game/audio';
import { BOSSES, STORY, bossName, type StoryLevel } from './data/story';
import { getMap } from './data/maps';
import type { RaceConfig, RaceResult } from './game/types';

type Screen = 'menu' | 'garage' | 'setup' | 'story' | 'race' | 'results';

/** completes a race setup with the player's car, paint, driver and settings */
function buildConfig(save: SaveData, setup: RaceSetup, extra: Partial<RaceConfig> = {}): RaceConfig {
  return {
    ...setup,
    carId: save.selectedCar,
    paint: save.paints[save.selectedCar],
    driver: save.driver,
    intro: save.intro,
    quality: save.quality,
    ...extra,
  };
}

function storyConfig(save: SaveData, level: StoryLevel): RaceConfig {
  const boss = BOSSES[level.chapter - 1];
  return buildConfig(
    save,
    {
      mapId: level.mapId,
      theme: getMap(level.mapId).theme,
      mode: { kind: 'race', laps: level.laps },
      difficulty: level.difficulty,
      opponents: level.opponents,
      items: level.items,
    },
    {
      storyLevel: level.n,
      rival: level.duel ? { carId: boss.carId, name: bossName(level.chapter), look: boss.look } : undefined,
    },
  );
}

export default function App() {
  const [save, update] = useSave();
  const [screen, setScreen] = useState<Screen>('menu');
  const [config, setConfig] = useState<RaceConfig | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [raceKey, setRaceKey] = useState(0);

  useEffect(() => {
    audio.setMuted(save.muted);
  }, [save.muted]);

  const startRace = (cfg: RaceConfig) => {
    audio.init();
    setConfig(cfg);
    setRaceKey((k) => k + 1);
    setScreen('race');
  };

  const finishRace = (r: RaceResult) => {
    setResult(r);
    const level = r.storyLevel ? STORY[r.storyLevel - 1] : null;
    const ok = level ? r.playerPlace <= level.needPlace : null;
    setPassed(ok);
    update((s) => {
      const next = {
        ...s,
        coins: s.coins + r.playerCoins,
        races: s.races + 1,
        wins: s.wins + (r.playerPlace === 1 ? 1 : 0),
      };
      if (level && ok) {
        // the completion bonus is paid the first time a level is beaten
        if (level.n > s.storyDone) next.coins += level.reward;
        next.storyDone = Math.max(s.storyDone, level.n);
        next.storyBest = { ...s.storyBest, [level.n]: Math.min(s.storyBest[level.n] ?? 99, r.playerPlace) };
      }
      return next;
    });
    setScreen('results');
  };

  const nextLevel = result?.storyLevel && passed && result.storyLevel < 100 ? STORY[result.storyLevel] : null;

  return (
    <div className="h-full w-full overflow-hidden">
      {screen === 'menu' && (
        <MainMenu
          save={save}
          update={update}
          onPlay={() => setScreen('setup')}
          onStory={() => setScreen('story')}
          onGarage={() => setScreen('garage')}
          onToggleSound={() => update((s) => ({ ...s, muted: !s.muted }))}
        />
      )}
      {screen === 'garage' && <Garage save={save} update={update} onBack={() => setScreen('menu')} />}
      {screen === 'story' && <Story save={save} onBack={() => setScreen('menu')} onPlay={(lv) => startRace(storyConfig(save, lv))} />}
      {screen === 'setup' && (
        <Setup
          save={save}
          onBack={() => setScreen('menu')}
          onGarage={() => setScreen('garage')}
          onDifficulty={(d) => update((s) => ({ ...s, difficulty: d }))}
          onStart={(setup) => startRace(buildConfig(save, setup))}
        />
      )}
      {screen === 'race' && config && (
        <RaceScreen
          key={raceKey}
          config={config}
          muted={save.muted}
          onToggleSound={() => update((s) => ({ ...s, muted: !s.muted }))}
          mirrors={save.mirrors}
          onToggleMirrors={() => update((s) => ({ ...s, mirrors: !s.mirrors }))}
          onFinish={finishRace}
          onExit={() => setScreen(config.storyLevel ? 'story' : 'menu')}
          onRestart={() => setRaceKey((k) => k + 1)}
        />
      )}
      {screen === 'results' && result && config && (
        <Results
          result={result}
          totalCoins={save.coins}
          passed={passed}
          onAgain={() => startRace({ ...config, intro: false })}
          onNext={nextLevel ? () => startRace(storyConfig(save, nextLevel)) : null}
          onStory={config.storyLevel ? () => setScreen('story') : null}
          onMenu={() => setScreen('menu')}
          onGarage={() => setScreen('garage')}
        />
      )}
    </div>
  );
}
