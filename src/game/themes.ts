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

/**
 * Palettes are tuned to be calm and easy on the eyes: soft skies, muted ground colours, a gentle
 * sun and no pure white surfaces (pure white under the sun blooms and glares like a lamp).
 */
export const THEME_STYLES: Record<ThemeId, ThemeStyle> = {
  city: {
    // warm dusk instead of a harsh neon night
    skyTop: '#2c3e66',
    skyHorizon: '#e9b48f',
    skyBottom: '#3b4566',
    fog: '#626a8a',
    fogNear: 200,
    fogFar: 1000,
    hemiSky: '#c7c3e3',
    hemiGround: '#2f3444',
    hemiIntensity: 0.95,
    sun: '#ffd8b0',
    sunIntensity: 1.9,
    sunDir: [-0.5, 0.6, -0.45],
    envIntensity: 0.4,
    exposure: 1.0,
    road: '#33343c',
    roadLine: '#d9d9dc',
    roadEdge: '#e2bf6a',
    curbA: '#c2414f',
    curbB: '#dcdcdf',
    groundA: '#34463a',
    groundB: '#2d3d32',
    wallA: '#b9bac4',
    wallB: '#b6505b',
    cliff: '#5d5866',
    cliffDark: '#2c2832',
    abyss: '#2b4f9e',
    abyssGlow: 0.2,
    barrierA: '#de7a3c',
    barrierB: '#d8d8dc',
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
  },
  desert: {
    skyTop: '#5d9ad0',
    skyHorizon: '#f3dcb6',
    skyBottom: '#e3c39a',
    fog: '#ecd6b6',
    fogNear: 260,
    fogFar: 1250,
    hemiSky: '#fbefd9',
    hemiGround: '#b98a55',
    hemiIntensity: 0.9,
    sun: '#fff1db',
    sunIntensity: 2.2,
    sunDir: [0.4, 0.8, 0.3],
    envIntensity: 0.4,
    exposure: 0.95,
    road: '#5e5045',
    roadLine: '#e6d5b0',
    roadEdge: '#d9a74a',
    curbA: '#b8483e',
    curbB: '#e0c48c',
    groundA: '#dcb983',
    groundB: '#d1ab76',
    wallA: '#8b6544',
    wallB: '#a07b58',
    cliff: '#ad6440',
    cliffDark: '#5a3220',
    abyss: '#6b3420',
    abyssGlow: 0.12,
    barrierA: '#9c6b2a',
    barrierB: '#734424',
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524'],
  },
  ocean: {
    // clear lagoon blue instead of a dark, murky deep sea
    skyTop: '#0e4466',
    skyHorizon: '#4aa6c4',
    skyBottom: '#0f4d6c',
    fog: '#2f7c9e',
    fogNear: 90,
    fogFar: 640,
    hemiSky: '#ade3f2',
    hemiGround: '#1d5874',
    hemiIntensity: 1.15,
    sun: '#d6f4ff',
    sunIntensity: 1.7,
    sunDir: [0.2, 1, 0.1],
    envIntensity: 0.45,
    exposure: 1.0,
    road: '#2a4a60',
    roadLine: '#9fd9e6',
    roadEdge: '#5cc3d6',
    curbA: '#d77fa8',
    curbB: '#ead9a6',
    groundA: '#d5c497',
    groundB: '#c8b787',
    wallA: '#d9828f',
    wallB: '#d9a453',
    cliff: '#2a6577',
    cliffDark: '#0b2f40',
    abyss: '#06243a',
    abyssGlow: 0.3,
    barrierA: '#d98bb3',
    barrierB: '#b49be0',
    skin: ['#fde68a'],
  },
  pixel: {
    skyTop: '#5ea8e0',
    skyHorizon: '#c4e6f7',
    skyBottom: '#86c56b',
    fog: '#c4e6f7',
    fogNear: 280,
    fogFar: 1350,
    hemiSky: '#f2f6fa',
    hemiGround: '#55904a',
    hemiIntensity: 1.0,
    sun: '#fffaf0',
    sunIntensity: 2.0,
    sunDir: [0.3, 0.9, -0.3],
    envIntensity: 0.3,
    exposure: 0.95,
    road: '#5a5a63',
    roadLine: '#dedee2',
    roadEdge: '#e2c23c',
    curbA: '#c8423c',
    curbB: '#dadade',
    groundA: '#68b84a',
    groundB: '#5aa83f',
    wallA: '#b05a2a',
    wallB: '#7d3412',
    cliff: '#8b5f37',
    cliffDark: '#583a1b',
    abyss: '#24154a',
    abyssGlow: 0.3,
    barrierA: '#b05a2a',
    barrierB: '#e8c47a',
    skin: ['#ffcc99', '#f0a070'],
  },
  candy: {
    // soft pastels instead of saturated pink everywhere
    skyTop: '#c3b3ec',
    skyHorizon: '#fbe3ee',
    skyBottom: '#efc5d8',
    fog: '#f1d9e5',
    fogNear: 240,
    fogFar: 1100,
    hemiSky: '#fbf0f6',
    hemiGround: '#d98fb2',
    hemiIntensity: 0.95,
    sun: '#fff6fa',
    sunIntensity: 1.9,
    sunDir: [-0.3, 0.85, 0.4],
    envIntensity: 0.45,
    exposure: 0.92,
    road: '#5c3a2c',
    roadLine: '#f0dde6',
    roadEdge: '#e69bbf',
    curbA: '#e05a7e',
    curbB: '#efe2e8',
    groundA: '#f1bcd5',
    groundB: '#ebb0cb',
    wallA: '#e0739a',
    wallB: '#f1e3ea',
    cliff: '#7a4c38',
    cliffDark: '#3d2216',
    abyss: '#4a2618',
    abyssGlow: 0.1,
    barrierA: '#efb0cc',
    barrierB: '#f3e7a6',
    skin: ['#c98b52'],
  },
};
