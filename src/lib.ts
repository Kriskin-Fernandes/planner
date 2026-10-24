// ---------------------------------------------------------------------------
// Shared pure utilities: colour science (CIELAB), image resizing/compression
// via the Canvas API, local date/recurrence helpers, and a deterministic
// local natural-language task parser. No IndexedDB, no network calls here.
// ---------------------------------------------------------------------------
import { addDays, addWeeks, addMonths, formatDistanceToNowStrict, isValid } from 'date-fns';
import type { Recurrence, TaskPriority } from './types';

// ============================ GENERIC ============================================

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

// ============================ DATES ===============================================

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!isValid(d)) return null;
  const now = new Date();
  const msPerDay = 86400000;
  const dayStart = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.round((dayStart(d) - dayStart(now)) / msPerDay);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (!isValid(d)) return 'No date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (!isValid(d)) return 'No date';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (!isValid(d)) return 'Never';
  return `${formatDistanceToNowStrict(d, { addSuffix: true })}`;
}

/** Advance `fromIso` to the next recurrence occurrence strictly after `after`. */
export function nextOccurrence(fromIso: string, recurrence: Recurrence, after: Date): Date | null {
  if (recurrence.freq === 'none') return null;
  let d = new Date(fromIso);
  if (recurrence.until && d > new Date(recurrence.until)) return null;
  const step = (dt: Date) => {
    switch (recurrence.freq) {
      case 'daily':
        return addDays(dt, recurrence.interval);
      case 'weekly':
        return addWeeks(dt, recurrence.interval);
      case 'monthly':
        return addMonths(dt, recurrence.interval);
      default:
        return dt;
    }
  };
  let guard = 0;
  while (d <= after && guard < 2000) {
    d = step(d);
    guard += 1;
  }
  if (recurrence.until && d > new Date(recurrence.until)) return null;
  return d;
}

export function isBetween(d: Date, start: Date, end: Date): boolean {
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

// ============================ LOCAL NLP: DATES / TASKS =============================

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Deterministic local parser for common relative-date phrases ("tomorrow",
 * "next monday", "in 3 days", "friday at 5pm"). Returns null if nothing
 * recognisable is found -- callers fall back to manual date entry or Gemini. */
export function parseLocalDatePhrase(text: string, now: Date = new Date()): Date | null {
  const lower = text.toLowerCase();
  let base: Date | null = null;

  if (/\btoday\b/.test(lower)) base = new Date(now);
  else if (/\btomorrow\b/.test(lower)) base = addDays(now, 1);
  else if (/\bnext week\b/.test(lower)) base = addWeeks(now, 1);
  else {
    const inDays = lower.match(/in (\d+) days?/);
    if (inDays) base = addDays(now, parseInt(inDays[1], 10));
    const inWeeks = lower.match(/in (\d+) weeks?/);
    if (inWeeks) base = addWeeks(now, parseInt(inWeeks[1], 10));
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (lower.includes(WEEKDAYS[i])) {
        const target = i;
        const current = now.getDay();
        let delta = target - current;
        if (delta <= 0 || /\bnext\b/.test(lower)) delta += 7;
        base = addDays(now, delta);
        break;
      }
    }
  }
  if (!base) return null;

  const timeMatch = lower.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  if (timeMatch && (timeMatch[4] || timeMatch[2])) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    if (timeMatch[4] === 'pm' && hour < 12) hour += 12;
    if (timeMatch[4] === 'am' && hour === 12) hour = 0;
    base.setHours(hour, minute, 0, 0);
  } else {
    base.setHours(9, 0, 0, 0);
  }
  return base;
}

/** Deterministic local parser for simple recurrence phrases ("every day",
 * "weekly", "every 2 weeks", "monthly"). */
export function parseLocalRecurrencePhrase(text: string): Recurrence {
  const lower = text.toLowerCase();
  const everyN = lower.match(/every (\d+) (day|week|month)s?/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    const unit = everyN[2];
    return { freq: unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : 'monthly', interval: n };
  }
  if (/\bdaily\b|\bevery day\b/.test(lower)) return { freq: 'daily', interval: 1 };
  if (/\bweekly\b|\bevery week\b/.test(lower)) return { freq: 'weekly', interval: 1 };
  if (/\bmonthly\b|\bevery month\b/.test(lower)) return { freq: 'monthly', interval: 1 };
  return { freq: 'none', interval: 1 };
}

export interface ParsedTask {
  title: string;
  dueAt: string | null;
  location?: string;
  priority?: TaskPriority;
  recurrence: Recurrence;
}

/** Deterministic local classification: strips recognised date/location/priority
 * phrases from the text to leave a clean title. Used when Gemini is not
 * configured, and as the fallback when a Gemini call fails. */
export function parseTaskText(text: string): ParsedTask {
  const now = new Date();
  const date = parseLocalDatePhrase(text, now);
  const recurrence = parseLocalRecurrencePhrase(text);

  let priority: TaskPriority | undefined;
  if (/\burgent\b|\basap\b/i.test(text)) priority = 'urgent';
  else if (/\bimportant\b|\bhigh priority\b/i.test(text)) priority = 'high';
  else if (/\blow priority\b|\bwhenever\b/i.test(text)) priority = 'low';

  let location: string | undefined;
  const atMatch = text.match(/\bat ([A-Z][\w' ]{2,30})/);
  if (atMatch) location = atMatch[1].trim();

  let title = text
    .replace(/\b(today|tomorrow|next week)\b/gi, '')
    .replace(/\bin \d+ (days?|weeks?)\b/gi, '')
    .replace(/\bevery (\d+ )?(day|week|month)s?\b/gi, '')
    .replace(/\b(daily|weekly|monthly)\b/gi, '')
    .replace(new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`, 'gi'), '')
    .replace(/\b(urgent|asap|important|high priority|low priority|whenever)\b/gi, '')
    .replace(atMatch ? atMatch[0] : '___NOPE___', '')
    .replace(/\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();
  if (!title) title = text.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title, dueAt: date ? date.toISOString() : null, location, priority, recurrence };
}

// ============================ COLOUR SCIENCE (CIELAB) ===============================

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full || '888888', 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB -> CIE L*a*b* (D65 white point). */
export function hexToLab(hex: string): { l: number; a: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function perceivedLightness(hex: string): number {
  return hexToLab(hex).l;
}

/** CIE76 Delta-E perceptual colour distance (0 = identical, ~100 = opposite). */
export function deltaE(hexA: string, hexB: string): number {
  const a = hexToLab(hexA);
  const b = hexToLab(hexB);
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/** Simple, explainable colour-harmony heuristic for a set of garment colours:
 * rewards some contrast (not all identical, not all clashing) and penalises
 * colours that sit in a visually jarring mid-distance band. This is a
 * structural heuristic, not a measured aesthetic judgement. */
export function colorHarmonyScore(hexColors: string[]): number {
  const colors = hexColors.filter(Boolean);
  if (colors.length <= 1) return 85;
  const pairs: number[] = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      pairs.push(deltaE(colors[i], colors[j]));
    }
  }
  const avg = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  // Sweet spot ~25-55 deltaE: distinguishable but not harsh. Score falls off
  // outside that band (too-similar -> monotonous; too-different -> clashing).
  let score: number;
  if (avg < 10) score = 60 + avg;
  else if (avg <= 55) score = 90 - Math.abs(avg - 35) * 0.3;
  else score = Math.max(40, 90 - (avg - 55) * 0.8);
  return clamp(Math.round(score), 0, 100);
}

// ============================ IMAGE PROCESSING (Canvas API) =========================

export interface DecodedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export async function resizeToCanvas(blob: Blob, maxDimension: number): Promise<DecodedImage> {
  const img = await loadImageFromBlob(blob);
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser');
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, width, height };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality);
  });
}

/** Resize an uploaded/captured image/file down to a sane display size.
 * Preserves the ability to keep the original separately -- callers decide
 * whether to also store the untouched original blob. */
export async function resizeImage(file: Blob, maxDimension = 1024): Promise<{ blob: Blob; width: number; height: number }> {
  const { canvas, width, height } = await resizeToCanvas(file, maxDimension);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
  return { blob, width, height };
}

/** Stronger compression specifically before sending an image to a remote AI
 * API, to send the minimum data necessary. */
export async function compressImageForUpload(blob: Blob, maxDimension = 768): Promise<Blob> {
  const { canvas } = await resizeToCanvas(blob, maxDimension);
  return canvasToBlob(canvas, 'image/jpeg', 0.7);
}

export function getPixelData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function average(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** Custom k-means-style colour clustering (no extra dependency needed beyond
 * the Canvas API) to extract the `count` most dominant colours from an image,
 * downsampled for speed. Good enough for garment/food swatches; not a claim
 * of exact fabric colour reproduction (camera white balance, lighting, etc.
 * all affect the result). */
export async function extractDominantColors(blob: Blob, count = 3): Promise<string[]> {
  const { canvas } = await resizeToCanvas(blob, 64);
  const { data } = getPixelData(canvas);
  const samples: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (samples.length === 0) return ['#888888'];

  const k = Math.min(count, samples.length);
  let centroids: [number, number, number][] = [];
  const step = Math.floor(samples.length / k) || 1;
  for (let i = 0; i < k; i++) centroids.push(samples[Math.min(i * step, samples.length - 1)]);

  for (let iter = 0; iter < 6; iter++) {
    const buckets: [number, number, number][][] = Array.from({ length: k }, () => []);
    for (const s of samples) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const [cr, cg, cb] = centroids[c];
        const dist = (s[0] - cr) ** 2 + (s[1] - cg) ** 2 + (s[2] - cb) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      buckets[best].push(s);
    }
    centroids = centroids.map((c, i) => {
      const bucket = buckets[i];
      if (bucket.length === 0) return c;
      return [average(bucket.map((p) => p[0])), average(bucket.map((p) => p[1])), average(bucket.map((p) => p[2]))];
    });
  }

  // Sort by cluster population (largest/most dominant first).
  const counts = new Array(k).fill(0);
  for (const s of samples) {
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const [cr, cg, cb] = centroids[c];
      const dist = (s[0] - cr) ** 2 + (s[1] - cg) ** 2 + (s[2] - cb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    counts[best] += 1;
  }
  return centroids
    .map((c, i) => ({ hex: rgbToHex(c[0], c[1], c[2]), count: counts[i] }))
    .sort((a, b) => b.count - a.count)
    .map((x) => x.hex);
}

/** Alias kept for feature-screen readability: the local (non-AI) colour
 * palette extraction used as the deterministic fallback for garment/food
 * colour detection when Gemini is not configured or unavailable. */
export const dominantColorPalette = extractDominantColors;

// ============================ GEO DISTANCE ===========================================

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minimum distance (metres) from a point to a polyline, using a local
 * equirectangular projection per segment -- adequate for the short
 * urban/suburban routes used in the Smart Shopping prototype. */
export function distancePointToPolylineMeters(point: { lat: number; lon: number }, line: { lat: number; lon: number }[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineMeters(point, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const toXY = (pt: { lat: number; lon: number }) => ({
      x: ((pt.lon - a.lon) * Math.PI * 6371000 * Math.cos((a.lat * Math.PI) / 180)) / 180,
      y: ((pt.lat - a.lat) * Math.PI * 6371000) / 180,
    });
    const A = toXY(a);
    const B = toXY(b);
    const P = toXY(point);
    const ABx = B.x - A.x;
    const ABy = B.y - A.y;
    const lenSq = ABx * ABx + ABy * ABy || 1e-9;
    let t = ((P.x - A.x) * ABx + (P.y - A.y) * ABy) / lenSq;
    t = clamp(t, 0, 1);
    const closest = { x: A.x + ABx * t, y: A.y + ABy * t };
    min = Math.min(min, Math.sqrt((P.x - closest.x) ** 2 + (P.y - closest.y) ** 2));
  }
  return min;
}

// ============================ MISC ===================================================

export function formatRelativeDays(days: number | null): string {
  if (days === null) return 'No date';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.split(',')[1] ?? '';
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Extract representative frames from a short video clip locally (no upload
 * of the full video). Samples up to `maxFrames` evenly spaced frames. */
export async function extractVideoFrames(file: File, maxFrames = 4): Promise<Blob[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not read video metadata'));
  });
  const duration = video.duration;
  const frames: Blob[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error('Canvas 2D context unavailable');
  }
  for (let i = 0; i < maxFrames; i++) {
    const t = (duration * (i + 1)) / (maxFrames + 1);
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = t;
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    frames.push(blob);
  }
  URL.revokeObjectURL(url);
  return frames;
}
