// ---------------------------------------------------------------------------
// Free OpenStreetMap-based geocoding, routing and place-discovery adapters
// for the Smart Shopping feature. Every provider is a small, replaceable
// function behind a narrow interface, using public low-volume endpoints.
// Respect rate limits: requests are cached in IndexedDB (aiCache store) and
// this module never polls or batches more than one request per user action.
// ---------------------------------------------------------------------------
import type { GeoPoint, StoreCandidate, TravelMode } from './types';
import { newId } from './types';
import { aiCacheGet, aiCacheSet } from './db';
import type { AiResult } from './ai';

const PHOTON_URL = 'https://photon.komoot.io/api/';
const OSRM_BASE = 'https://router.project-osrm.org'; // public demo server: low-volume prototyping only
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const OSRM_PROFILE: Record<TravelMode, string> = {
  walking: 'foot',
  cycling: 'bike',
  driving: 'driving',
  'public-transport': 'foot' // OSRM has no public-transit profile; we route on foot and label it clearly in the UI
};

export interface GeocodeResult {
  label: string;
  point: GeoPoint;
}

export async function geocode(query: string): Promise<AiResult<GeocodeResult[]>> {
  const cacheKey = `geocode:${query.toLowerCase().trim()}`;
  const cached = await aiCacheGet<GeocodeResult[]>(cacheKey);
  if (cached) return { status: 'ok', provider: 'local', data: cached };
  try {
    const res = await fetch(`${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const results: GeocodeResult[] = (json.features ?? []).map((f: any) => ({
      label: [f.properties?.name, f.properties?.city, f.properties?.country].filter(Boolean).join(', '),
      point: { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }
    }));
    await aiCacheSet(cacheKey, results);
    return { status: 'ok', provider: 'local', data: results };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: /failed to fetch/i.test(String(err)) ? 'network' : 'unknown',
      message: `Geocoding failed (Photon): ${err instanceof Error ? err.message : String(err)}. You can enter coordinates manually instead.`
    };
  }
}

export interface RouteResult {
  geometry: GeoPoint[];
  distanceMeters: number;
  durationSeconds: number;
}

export async function calculateRoute(start: GeoPoint, end: GeoPoint, mode: TravelMode): Promise<AiResult<RouteResult>> {
  const profile = OSRM_PROFILE[mode];
  const cacheKey = `route:${profile}:${start.lat.toFixed(4)},${start.lon.toFixed(4)}:${end.lat.toFixed(4)},${end.lon.toFixed(4)}`;
  const cached = await aiCacheGet<RouteResult>(cacheKey);
  if (cached) return { status: 'ok', provider: 'local', data: cached };
  try {
    const url = `${OSRM_BASE}/route/v1/${profile}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.message || 'No route found');
    const route = json.routes[0];
    const geometry: GeoPoint[] = route.geometry.coordinates.map(([lon, lat]: [number, number]) => ({ lat, lon }));
    const data: RouteResult = { geometry, distanceMeters: route.distance, durationSeconds: route.duration };
    await aiCacheSet(cacheKey, data);
    return { status: 'ok', provider: 'local', data };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: /failed to fetch/i.test(String(err)) ? 'network' : 'unknown',
      message: `Routing failed (OSRM public demo server): ${err instanceof Error ? err.message : String(err)}.`
    };
  }
}

function routeBoundingBox(route: GeoPoint[], paddingMeters: number): { south: number; west: number; north: number; east: number } {
  const lats = route.map((p) => p.lat);
  const lons = route.map((p) => p.lon);
  const padDeg = paddingMeters / 111000; // rough metres-to-degrees
  return {
    south: Math.min(...lats) - padDeg,
    north: Math.max(...lats) + padDeg,
    west: Math.min(...lons) - padDeg,
    east: Math.max(...lons) + padDeg
  };
}

/** Query Overpass for supermarkets/grocery stores within the route's bounding
 * box (further filtered to the corridor by `filterStoresNearRoute` in
 * services.ts using actual route geometry, not just the bounding box). */
export async function findSupermarketsNearRoute(route: GeoPoint[], corridorWidthMeters: number): Promise<AiResult<StoreCandidate[]>> {
  if (route.length === 0) {
    return { status: 'error', provider: 'local', errorType: 'invalid-response', message: 'No route geometry to search along.' };
  }
  const bbox = routeBoundingBox(route, corridorWidthMeters + 200);
  const cacheKey = `overpass:${bbox.south.toFixed(3)},${bbox.west.toFixed(3)},${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`;
  const cached = await aiCacheGet<StoreCandidate[]>(cacheKey);
  if (cached) return { status: 'ok', provider: 'local', data: cached };

  const query = `
    [out:json][timeout:20];
    (
      node["shop"~"supermarket|grocery|convenience"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["shop"~"supermarket|grocery|convenience"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out center 40;
  `;
  try {
    const res = await fetch(OVERPASS_URL, { method: 'POST', body: `data=${encodeURIComponent(query)}` });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const stores: StoreCandidate[] = (json.elements ?? [])
      .map((el: any) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat === undefined || lon === undefined) return null;
        return {
          id: `osm-${el.type}-${el.id}`,
          name: el.tags?.name || el.tags?.brand || 'Unnamed store',
          point: { lat, lon },
          detourMeters: 0,
          distanceFromRouteMeters: 0,
          osmTags: el.tags ?? {}
        } as StoreCandidate;
      })
      .filter((s: StoreCandidate | null): s is StoreCandidate => !!s);
    await aiCacheSet(cacheKey, stores);
    return { status: 'ok', provider: 'local', data: stores };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: /failed to fetch/i.test(String(err)) ? 'network' : 'unknown',
      message: `Store discovery failed (Overpass API): ${err instanceof Error ? err.message : String(err)}. You can add shops manually.`
    };
  }
}

export function newPlanId(): string {
  return newId();
}
