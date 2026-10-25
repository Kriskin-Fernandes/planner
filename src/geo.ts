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
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

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

export interface TransitWalkRoute {
  segments: GeoPoint[][];
  routeDistanceMeters: number;
  durationSeconds: number;
}

function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}

/** Reads the return transit itinerary and extracts only Google Maps WALK steps. */
export async function getTransitWalkingSegments(origin: GeoPoint, destination: GeoPoint, apiKey: string, mode: TravelMode = 'public-transport'): Promise<AiResult<TransitWalkRoute>> {
  // Route schedules and transit options are time-sensitive. Always ask Routes
  // for a fresh itinerary; only the slower-changing Places catalogue is cached.
  try {
    const travelMode = ({ walking: 'WALK', cycling: 'BICYCLE', driving: 'DRIVE', 'public-transport': 'TRANSIT' } as const)[mode];
    const transit = mode === 'public-transport';
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.duration' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lon } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lon } } },
        travelMode, computeAlternativeRoutes: true,
        ...(transit ? { transitPreferences: { routingPreference: 'LESS_WALKING', allowedTravelModes: ['BUS', 'SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'] } } : {})
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google Routes API HTTP ${response.status}: ${body?.error?.message ?? response.statusText}`);
    const route = body.routes?.[0];
    if (!route) throw new Error(`Google Maps did not return a ${mode} route for this trip.`);
    let segments: GeoPoint[][];
    let routeDistanceMeters = Number(route.distanceMeters ?? 0);
    if (transit) {
      const steps = (route.legs ?? []).flatMap((leg: any) => leg.steps ?? []);
      const walkSteps = steps.filter((step: any) => step.travelMode === 'WALK' && step.polyline?.encodedPolyline);
      segments = walkSteps.map((step: any) => decodePolyline(step.polyline.encodedPolyline)).filter((points: GeoPoint[]) => points.length > 1);
      routeDistanceMeters = walkSteps.reduce((sum: number, step: any) => sum + Number(step.distanceMeters ?? 0), 0);
      if (!segments.length) throw new Error('The Google Maps transit route did not include any walkable sections to search.');
    } else {
      const line = route.polyline?.encodedPolyline;
      segments = line ? [decodePolyline(line)] : [];
      if (!segments[0] || segments[0].length < 2) throw new Error(`Google Maps did not return route geometry for ${mode}.`);
    }
    const data = { segments, routeDistanceMeters, durationSeconds: Number(String(route.duration ?? '0s').replace('s', '')) };
    // Do not persist route results: Smart Shop must use current directions.
    return { status: 'ok', provider: 'local', data };
  } catch (err) {
    return { status: 'error', provider: 'local', errorType: /API HTTP 4(00|03)/i.test(String(err)) ? 'invalid-key' : /failed to fetch|network/i.test(String(err)) ? 'network' : 'unavailable', message: err instanceof Error ? err.message : String(err) };
  }
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
const activeStoreSearches = new Map<string, Promise<AiResult<StoreCandidate[]>>>();

export function findSupermarketsNearRoute(route: GeoPoint[], corridorWidthMeters: number, apiKey = ''): Promise<AiResult<StoreCandidate[]>> {
  const requestKey = `${corridorWidthMeters}:${route.map((point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`).join(';')}`;
  const active = activeStoreSearches.get(requestKey);
  if (active) return active;
  const request = findSupermarketsNearRouteUncached(route, corridorWidthMeters, apiKey).finally(() => activeStoreSearches.delete(requestKey));
  activeStoreSearches.set(requestKey, request);
  return request;
}

async function findSupermarketsNearRouteUncached(route: GeoPoint[], corridorWidthMeters: number, apiKey: string): Promise<AiResult<StoreCandidate[]>> {
  if (route.length === 0) {
    return { status: 'error', provider: 'local', errorType: 'invalid-response', message: 'No route geometry to search along.' };
  }
  const bbox = routeBoundingBox(route, corridorWidthMeters + 200);
  const cacheKey = `osm-stores:${bbox.south.toFixed(3)},${bbox.west.toFixed(3)},${bbox.north.toFixed(3)},${bbox.east.toFixed(3)}`;
  const cached = await aiCacheGet<{ savedAt: number; stores: StoreCandidate[] }>(cacheKey);
  if (cached && Date.now() - cached.savedAt < 7 * 24 * 60 * 60 * 1000) return { status: 'ok', provider: 'local', data: cached.stores };

  let placesFallbackReason = '';
  if (apiKey.trim()) {
    try {
      const points: GeoPoint[] = [];
      let walkedSinceSearch = Infinity;
      for (let i = 0; i < route.length; i++) {
        if (walkedSinceSearch >= 600 || i === 0 || i === route.length - 1) {
          points.push(route[i]);
          walkedSinceSearch = 0;
        }
        if (i > 0) {
          const a = route[i - 1], b = route[i];
          const dy = (b.lat - a.lat) * 111_000;
          const dx = (b.lon - a.lon) * 111_000 * Math.cos(a.lat * Math.PI / 180);
          walkedSinceSearch += Math.hypot(dx, dy);
        }
      }
      const cells = new Map<string, GeoPoint>();
      for (const point of points) {
        // A ~330m grid lets different routes and corridor widths reuse the
        // same Places response. Search from the cell centre with enough radius
        // to cover the full supported 1.5km corridor plus grid offset.
        const latCell = Math.round(point.lat / 0.003) * 0.003;
        const lonCell = Math.round(point.lon / 0.003) * 0.003;
        const key = `${latCell.toFixed(3)},${lonCell.toFixed(3)}`;
        cells.set(key, { lat: latCell, lon: lonCell });
      }
      const found = new Map<string, StoreCandidate>();
      for (const [cell, point] of cells) {
        const cellCacheKey = `google-places-cell-v2:${cell}`;
        const cachedCell = await aiCacheGet<{ savedAt: number; stores: StoreCandidate[] }>(cellCacheKey);
        if (cachedCell && Date.now() - cachedCell.savedAt < 7 * 24 * 60 * 60 * 1000) {
          cachedCell.stores.forEach((store) => found.set(store.id, store));
          continue;
        }
        const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.types,places.formattedAddress' },
          body: JSON.stringify({
            includedTypes: ['supermarket', 'grocery_store', 'convenience_store', 'food_store'],
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: { circle: { center: { latitude: point.lat, longitude: point.lon }, radius: 2000 } }
          })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`Google Places HTTP ${response.status}: ${body?.error?.message ?? response.statusText}`);
        const cellStores: StoreCandidate[] = [];
        for (const place of body.places ?? []) {
          if (!place.id || !place.location) continue;
          const candidate: StoreCandidate = {
            id: `google-${place.id}`,
            name: place.displayName?.text ?? place.formattedAddress ?? 'Supermarket',
            point: { lat: place.location.latitude, lon: place.location.longitude },
            detourMeters: 0,
            distanceFromRouteMeters: 0,
            osmTags: { provider: 'Google Places', types: (place.types ?? []).join(',') },
            assignedItemIds: []
          };
          found.set(candidate.id, candidate);
          cellStores.push(candidate);
        }
        await aiCacheSet(cellCacheKey, { savedAt: Date.now(), stores: cellStores }, 7 * 24 * 60 * 60 * 1000);
      }
      const places = [...found.values()];
      return { status: 'ok', provider: 'local', data: places };
    } catch (err) {
      // Google Places is the primary source. If it is not enabled for the key,
      // keep a public OSM directory as a resilient fallback.
      placesFallbackReason = err instanceof Error ? err.message : String(err);
      console.warn('Google Places store lookup failed; trying public directory fallback.', err);
    }
  }

  const query = `
    [out:json][timeout:20];
    (
      node["shop"~"supermarket|grocery|convenience"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      way["shop"~"supermarket|grocery|convenience"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out center 40;
  `;
  try {
    let json: any = null;
    let lastError = 'No Overpass endpoint responded';
    for (const endpoint of OVERPASS_URLS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 18000);
          const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: `data=${encodeURIComponent(query)}`, signal: controller.signal });
          clearTimeout(timer);
          if (res.status === 429 || res.status === 503) {
            lastError = `HTTP ${res.status}`;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 500));
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          json = await res.json();
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      if (json) break;
    }
    if (!json) throw new Error(lastError);
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
    await aiCacheSet(cacheKey, { savedAt: Date.now(), stores }, 7 * 24 * 60 * 60 * 1000);
    return { status: 'ok', provider: 'local', data: stores };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: /failed to fetch/i.test(String(err)) ? 'network' : 'unknown',
      message: `${placesFallbackReason ? `Google Places failed (${placesFallbackReason}); ` : ''}store directory fallback failed: ${err instanceof Error ? err.message : String(err)}.`
    };
  }
}

export function newPlanId(): string {
  return newId();
}
