import type { LatLng } from "./types";

export const CTO_CAPACITY = 8;
export const MAX_CELL_LENGTH_M = 240;
export const RECOMMENDED_MIN = 40;
export const RECOMMENDED_MAX = 60;

export const POLYGON_DEFAULT_NAME = "N° RESIDÊNCIAS: ";
export const POLYGON_DEFAULT_DESCRIPTION = "TAXA DE PENETRAÇÃO: %   XCTO\nTM DA CÉLULA: M / 2 = M - UM;";
export const MARKER_DEFAULT_NAME = "Marcador de local sem título";

/** Exact rate in percent (unrounded, uncapped). Integer math first to avoid float drift. */
export function rawRate(residences: number, ctos: number): number {
  if (!(residences > 0)) return 0;
  return (ctos * CTO_CAPACITY * 100) / residences;
}

/** Rate shown in description: rounded half-up to integer, capped at 100. */
export function displayRate(residences: number, ctos: number): number {
  if (!(residences > 0)) return 0;
  const num = ctos * CTO_CAPACITY * 100;
  // half-up integer rounding with integer arithmetic: floor((2*num + res) / (2*res))
  const r = Math.floor((2 * num + residences) / (2 * residences));
  return Math.min(r, 100);
}

export type RateStatus = "low" | "ok" | "high";
export function rateStatus(rate: number): RateStatus {
  if (rate < RECOMMENDED_MIN) return "low";
  if (rate > RECOMMENDED_MAX) return "high";
  return "ok";
}

/** Format a meter value: integers as-is, otherwise 1 decimal with comma. */
export function fmtM(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
}

export function ftthTitle(residences: number): string {
  return `Nº RESIDÊNCIAS: ${residences}`;
}

export function ftthDescription(residences: number, ctos: number, lengthM: number): string {
  const half = lengthM / 2;
  return `TAXA DE PENETRAÇÃO: ${displayRate(residences, ctos)}% ${ctos}CTO\nTM DA CÉLULA: ${fmtM(lengthM)}M / 2 = ${fmtM(half)}M - UM`;
}

// ---------- geometry ----------
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(pts: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distanceM(pts[i - 1]!, pts[i]!);
  return s;
}

/**
 * Estimated cell length (m) from polygon shape.
 * 4 vertices (rectangle / trapezoid): the longer of the two averages of opposite sides
 * (trapezoid mid-line = (a+b)/2; for a rectangle equals the long side).
 * Otherwise: long side of the minimum-area bounding rectangle.
 */
export function polygonCellLength(coords: LatLng[]): number {
  const pts = [...coords];
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 3 && f && l && f.lat === l.lat && f.lng === l.lng) pts.pop();
  if (pts.length < 3) return 0;
  if (pts.length === 4) {
    const s = [0, 1, 2, 3].map((i) => distanceM(pts[i]!, pts[(i + 1) % 4]!));
    return Math.max((s[0]! + s[2]!) / 2, (s[1]! + s[3]!) / 2);
  }
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const k = Math.cos(rad(lat0));
  const xy = pts.map((p) => [rad(p.lng) * R * k, rad(p.lat) * R] as const);
  let best = { area: Infinity, long: 0 };
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!, b = xy[(i + 1) % xy.length]!;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of xy) {
      const rx = x * c - y * s, ry = x * s + y * c;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    const w = maxX - minX, h = maxY - minY;
    if (w * h < best.area) best = { area: w * h, long: Math.max(w, h) };
  }
  return best.long;
}
