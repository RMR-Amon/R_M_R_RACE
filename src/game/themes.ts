import type { ThemeId } from './types';

export interface ThemeStyle {
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  envIntensity: number;
  exposure: number;
  road: string;
  roadLine: string;
  roadEdge: string;
  curbA: string;
  curbB: string;
  groundA: string;
  groundB: string;
  wallA: string;
  wallB: string;
  cliff: string;
  cliffDark: string;
  abyss: string;
  abyssGlow: number;
  barrierA: string;
  barrierB: string;
  skin: string[];
}

export const THEME_STYLES: Record<ThemeId, ThemeStyle> = {
  city: {
    skyTop: '#140b3a',
    skyHorizon: '#ff6a88',
    skyBottom: '#2b1055',
    fog: '#3a1d5c',
    fogNear: 160,
    fogFar: 900,
    hemiSky: '#a78bfa',
    hemiGround: '#2a1a3a',
    hemiIntensity: 0.9,
    sun: '#ffb38a',
    sunIntensity: 2.2,
    sunDir: [-0.5, 0.6, -0.45],
    envIntensity: 0.55,
    exposure: 1.05,
    road: '#2c2c34',
    roadLine: '#f5f5f5',
    roadEdge: '#ffd166',
    curbA: '#ef233c',
    curbB: '#f8f9fa',
    groundA: '#2d3b2f',
    groundB: '#253226',
    wallA: '#d9d9e0',
    wallB: '#e63946',
    cliff: '#5b5463',
    cliffDark: '#2a2530',
    abyss: '#1d4ed8',
    abyssGlow: 0.35,
    barrierA: '#f97316',
    barrierB: '#f8fafc',
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
  },
  desert: {
    skyTop: '#2f80ed',
    skyHorizon: '#ffd194',
    skyBottom: '#f4a261',
    fog: '#f2c48d',
    fogNear: 220,
    fogFar: 1150,
    hemiSky: '#fff3d6',
    hemiGround: '#c47f3b',
    hemiIntensity: 1.0,
    sun: '#fff1d0',
    sunIntensity: 3.0,
    sunDir: [0.4, 0.8, 0.3],
    envIntensity: 0.6,
    exposure: 1.0,
    road: '#59473a',
    roadLine: '#ffe8b0',
    roadEdge: '#ffb703',
    curbA: '#d62828',
    curbB: '#fcbf49',
    groundA: '#e9b872',
    groundB: '#dda15e',
    wallA: '#8b5a2b',
    wallB: '#a47148',
    cliff: '#b5562f',
    cliffDark: '#5c2a14',
    abyss: '#7c2d12',
    abyssGlow: 0.2,
    barrierA: '#a16207',
    barrierB: '#78350f',
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'],
  },
  ocean: {
    skyTop: '#00122e',
    skyHorizon: '#0a6aa8',
    skyBottom: '#01203f',
    fog: '#0b4f7d',
    fogNear: 50,
    fogFar: 420,
    hemiSky: '#7dd3fc',
    hemiGround: '#0c4a6e',
    hemiIntensity: 1.25,
    sun: '#b9f3ff',
    sunIntensity: 2.0,
    sunDir: [0.2, 1, 0.1],
    envIntensity: 0.6,
    exposure: 1.1,
    road: '#1d3a52',
    roadLine: '#67e8f9',
    roadEdge: '#22d3ee',
    curbA: '#f472b6',
    curbB: '#fde68a',
    groundA: '#d8c38f',
    groundB: '#c9b27a',
    wallA: '#fb7185',
    wallB: '#f59e0b',
    cliff: '#1e5f74',
    cliffDark: '#062636',
    abyss: '#020617',
    abyssGlow: 0.6,
    barrierA: '#f472b6',
    barrierB: '#c084fc',
    skin: ['#fde68a'],
  },
  pixel: {
    skyTop: '#3aa0ff',
    skyHorizon: '#a8e4ff',
    skyBottom: '#7ccf5f',
    fog: '#a8e4ff',
    fogNear: 260,
    fogFar: 1300,
    hemiSky: '#ffffff',
    hemiGround: '#4d8f3a',
    hemiIntensity: 1.1,
    sun: '#ffffff',
    sunIntensity: 2.6,
    sunDir: [0.3, 0.9, -0.3],
    envIntensity: 0.35,
    exposure: 1.0,
    road: '#55555f',
    roadLine: '#ffffff',
    roadEdge: '#ffd400',
    curbA: '#e52521',
    curbB: '#ffffff',
    groundA: '#5bc236',
    groundB: '#4caf2a',
    wallA: '#c84c0c',
    wallB: '#8b2e08',
    cliff: '#8b5a2b',
    cliffDark: '#5a3714',
    abyss: '#1a0b3b',
    abyssGlow: 0.5,
    barrierA: '#c84c0c',
    barrierB: '#ffcc66',
    skin: ['#ffcc99', '#f0a070'],
  },
  candy: {
    skyTop: '#c084fc',
    skyHorizon: '#ffd6ec',
    skyBottom: '#f9a8d4',
    fog: '#ffd1e8',
    fogNear: 200,
    fogFar: 1000,
    hemiSky: '#fff0f8',
    hemiGround: '#f472b6',
    hemiIntensity: 1.1,
    sun: '#fff5fb',
    sunIntensity: 2.4,
    sunDir: [-0.3, 0.85, 0.4],
    envIntensity: 0.7,
    exposure: 1.0,
    road: '#5a3424',
    roadLine: '#fff1f8',
    roadEdge: '#ff8fc7',
    curbA: '#ff3b6b',
    curbB: '#ffffff',
    groundA: '#ffb6d9',
    groundB: '#ffa3cf',
    wallA: '#ff4d88',
    wallB: '#ffffff',
    cliff: '#7a4630',
    cliffDark: '#3d1f12',
    abyss: '#4a2414',
    abyssGlow: 0.15,
    barrierA: '#f9a8d4',
    barrierB: '#fef08a',
    skin: ['#c98b52'],
  },
};
