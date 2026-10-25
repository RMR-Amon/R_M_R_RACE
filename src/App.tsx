import { useEffect, useState } from 'react';
import MainMenu from './components/MainMenu';
import Garage from './components/Garage';
import Setup from './components/Setup';
import RaceScreen from './components/RaceScreen';
import Results from './components/Results';
import { useSave } from './store/save';
import { audio } from './game/audio';
import type { RaceConfig, RaceResult } from './game/types';

type Screen = 'menu' | 'garage' | 'setup' | 'race' | 'results';

export default function App() {
  const [save, update] = useSave();
  const [screen, setScreen] = useState<Screen>('menu');
  const [config, setConfig] = useState<RaceConfig | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
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
    update((s) => ({
      ...s,
      coins: s.coins + r.playerCoins,
      races: s.races + 1,
      wins: s.wins + (r.playerPlace === 1 ? 1 : 0),
    }));
    setScreen('results');
  };

  return (
    <div className="h-full w-full overflow-hidden">
      {screen === 'menu' && (
        <MainMenu
          save={save}
          onPlay={() => setScreen('setup')}
          onGarage={() => setScreen('garage')}
          onToggleSound={() => update((s) => ({ ...s, muted: !s.muted }))}
        />
      )}
      {screen === 'garage' && <Garage save={save} update={update} onBack={() => setScreen('menu')} />}
      {screen === 'setup' && (
        <Setup save={save} onBack={() => setScreen('menu')} onGarage={() => setScreen('garage')} onStart={startRace} />
      )}
      {screen === 'race' && config && (
        <RaceScreen
          key={raceKey}
          config={config}
          muted={save.muted}
          onToggleSound={() => update((s) => ({ ...s, muted: !s.muted }))}
          onFinish={finishRace}
          onExit={() => setScreen('menu')}
          onRestart={() => setRaceKey((k) => k + 1)}
        />
      )}
      {screen === 'results' && result && config && (
        <Results
          result={result}
          totalCoins={save.coins}
          onAgain={() => startRace(config)}
          onMenu={() => setScreen('menu')}
          onGarage={() => setScreen('garage')}
        />
      )}
    </div>
  );
}
