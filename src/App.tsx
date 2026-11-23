import { useEffect, useRef, useState } from 'react';
import MainMenu from './components/MainMenu';
import Garage from './components/Garage';
import Setup, { type RaceSetup } from './components/Setup';
import Story from './components/Story';
import RaceScreen from './components/RaceScreen';
import Results from './components/Results';
import MultiplayerMenu from './components/multiplayer/MultiplayerMenu';
import Lobby from './components/multiplayer/Lobby';
import { useSave, type SaveData } from './store/save';
import { audio } from './game/audio';
import { BOSSES, STORY, bossName, type StoryLevel } from './data/story';
import { getMap, mapName } from './data/maps';
import { getCar } from './data/cars';
import { net, savedSession, useNet, type ResultsView } from './net/session';
import { desktopApi, setJoinHost, type LaunchRoute } from './net/desktop';
import type { MatchInfo } from './net/protocol';
import type { RaceConfig, RaceResult } from './game/types';

type Screen = 'menu' | 'garage' | 'setup' | 'story' | 'race' | 'results' | 'mp' | 'lobby';

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

/** LAN match → engine config (the roster carries every player's car, paint and driver) */
function netConfig(save: SaveData, m: MatchInfo, you: number): RaceConfig {
  const me = m.roster.find((r) => r.id === you) ?? m.roster[0];
  return {
    mapId: m.mapId,
    theme: m.theme,
    mode: m.mode === 'battle' ? { kind: 'battle', duration: m.duration } : { kind: 'race', laps: m.laps },
    carId: me.carId,
    paint: me.paint ?? undefined,
    driver: me.look,
    difficulty: 'medium',
    opponents: 0,
    items: m.items,
    intro: false,
    quality: save.quality,
    net: net.link ?? undefined,
  };
}

/** host results → the results screen's format */
function netResult(r: ResultsView, you: number): RaceResult {
  const rows = r.rows.map((x) => ({
    name: x.name,
    isPlayer: x.id === you,
    color: x.color,
    carName: getCar(x.carId).name,
    place: x.place,
    time: x.time,
    points: x.points,
    hits: x.hits,
    coins: x.coins,
  }));
  const mine = rows.find((x) => x.isPlayer);
  return {
    mode: r.mode === 'battle' ? { kind: 'battle', duration: 0 } : { kind: 'race', laps: r.laps },
    mapName: mapName(getMap(r.mapId)),
    rows,
    playerCoins: mine?.coins ?? 0,
    playerPlace: mine?.place ?? rows.length,
    mistakes: 0,
  };
}

export default function App() {
  const [save, update] = useSave();
  const [screen, setScreen] = useState<Screen>('menu');
  const [config, setConfig] = useState<RaceConfig | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [raceKey, setRaceKey] = useState(0);
  const netView = useNet();
  const online = !!config?.net;

  useEffect(() => {
    audio.setMuted(save.muted);
  }, [save.muted]);

  // reloaded the page in the middle of a LAN session: rejoin the room automatically
  useEffect(() => {
    if (savedSession() && net.resumeSaved()) setScreen('lobby');
  }, []);

  // desktop: rmrrace://lan (from the website / a shortcut) opens LAN multiplayer directly
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    const go = (route: LaunchRoute | null) => {
      if (!route || route.screen !== 'lan') return;
      // never yank a player out of a running race or a lobby
      if (screenRef.current === 'race' || screenRef.current === 'lobby') return;
      setJoinHost(route.host ?? null);
      setScreen('mp');
    };
    void api.takeLaunchRoute().then(go);
    return api.onRoute(go);
  }, []);

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

  // ---------------------------------------------------------------- LAN session drives the screens
  const saveRef = useRef(save);
  saveRef.current = save;
  const seenRace = useRef(0);
  useEffect(() => {
    if (netView.phase === 'race' && netView.match && net.link && netView.raceKey !== seenRace.current) {
      seenRace.current = netView.raceKey;
      startRace(netConfig(saveRef.current, netView.match, netView.you));
    }
  }, [netView.phase, netView.raceKey, netView.match, netView.you]);

  const seenResults = useRef<ResultsView | null>(null);
  useEffect(() => {
    if (netView.phase === 'results' && netView.results && netView.results !== seenResults.current) {
      seenResults.current = netView.results;
      finishRace(netResult(netView.results, netView.you));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netView.phase, netView.results]);

  useEffect(() => {
    // the session ended (kicked, room closed, host lost) while racing / on results: show it in the lobby screen
    if (netView.phase === 'ended' && (screen === 'race' || screen === 'results')) setScreen('lobby');
    // a match that failed to start: back to the lobby
    if (netView.phase === 'lobby' && screen === 'race' && online) setScreen('lobby');
  }, [netView.phase, screen, online]);

  const leaveOnline = () => {
    net.leave();
    setConfig(null);
    setScreen('mp');
  };

  return (
    <div className="h-full w-full overflow-hidden">
      {screen === 'menu' && (
        <MainMenu
          save={save}
          update={update}
          onPlay={() => setScreen('setup')}
          onStory={() => setScreen('story')}
          onGarage={() => setScreen('garage')}
          onMultiplayer={() => setScreen('mp')}
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
      {screen === 'mp' && <MultiplayerMenu save={save} update={update} onBack={() => setScreen('menu')} onLobby={() => setScreen('lobby')} />}
      {screen === 'lobby' && <Lobby save={save} update={update} onExit={() => setScreen('mp')} />}
      {screen === 'race' && config && (
        <RaceScreen
          key={raceKey}
          config={config}
          muted={save.muted}
          onToggleSound={() => update((s) => ({ ...s, muted: !s.muted }))}
          mirrors={save.mirrors}
          onToggleMirrors={() => update((s) => ({ ...s, mirrors: !s.mirrors }))}
          onFinish={finishRace}
          onExit={online ? leaveOnline : () => setScreen(config.storyLevel ? 'story' : 'menu')}
          onRestart={() => setRaceKey((k) => k + 1)}
        />
      )}
      {screen === 'results' && result && config && (
        <Results
          result={result}
          totalCoins={save.coins}
          passed={passed}
          online={online}
          onAgain={
            online
              ? () => {
                  net.backToLobby();
                  setScreen('lobby');
                }
              : () => startRace({ ...config, intro: false })
          }
          onNext={nextLevelFor(result, passed, save)}
          onStory={config.storyLevel ? () => setScreen('story') : null}
          onMenu={online ? leaveOnline : () => setScreen('menu')}
          onGarage={() => setScreen('garage')}
        />
      )}
    </div>
  );

  function nextLevelFor(r: RaceResult, ok: boolean | null, s: SaveData) {
    const next = r.storyLevel && ok && r.storyLevel < 100 ? STORY[r.storyLevel] : null;
    return next ? () => startRace(storyConfig(s, next)) : null;
  }
}
