// ---------------------------------------------------------------------------
// Deterministic domain services: outfit scoring & recommendation, laundry
// rules, expiration monitoring, shopping reconciliation, calendar
// clash/recurrence handling, task grouping and shopping-route allocation.
// These are pure/data-in-data-out functions (no IndexedDB, no network) so
// they are unit-testable and reusable from any feature screen.
// ---------------------------------------------------------------------------
import { addDays, areIntervalsOverlapping, isWithinInterval } from 'date-fns';
import type {
  Garment,
  Outfit,
  OutfitLayer,
  CalendarEvent,
  Task,
  FoodItem,
  Recipe,
  ShoppingItem,
  Ingredient,
  AvailabilityStatus,
  LaundryGroup,
  StoreCandidate,
  GeoPoint,
  Recurrence
} from './types';
import { newId, nowIso } from './types';
import { clamp, colorHarmonyScore, daysUntil, nextOccurrence, round1 } from './lib';

// =========================== OUTFITS ==========================================

export interface OutfitContext {
  weatherTempC?: number;
  precipitationChance?: number; // 0-1
  warmthBias?: number; // user preference: negative = runs warm, positive = runs cold
  occasion?: string;
}

export function garmentsForLayers(layers: OutfitLayer[], byId: Map<string, Garment>): Garment[] {
  const out: Garment[] = [];
  for (const layer of layers) {
    for (const gid of layer.garmentIds) {
      const g = byId.get(gid);
      if (g) out.push(g);
    }
  }
  return out;
}

export function estimateOutfitWarmth(garments: Garment[]): number {
  if (garments.length === 0) return 0;
  // Layering bonus: multiple base/middle/outer layers trap more heat than the
  // simple average of individual warmth scores would suggest.
  const base = garments.reduce((sum, g) => sum + g.warmthScore, 0) / garments.length;
  const layerRoles = new Set(garments.map((g) => g.layerRole));
  const layerBonus = (layerRoles.has('base') ? 0.3 : 0) + (layerRoles.has('middle') ? 0.6 : 0) + (layerRoles.has('outer') ? 0.8 : 0);
  return round1(clamp(base + layerBonus, 0, 10));
}

export function estimateFormality(garments: Garment[]): number {
  // Heuristic: fewer "sport" textures/patterns and the presence of outerwear
  // without hoods nudges formality up; this is a rough structural estimate,
  // not a claim of true style classification.
  let score = 5;
  for (const g of garments) {
    if (g.features.hood) score -= 0.5;
    if (g.category === 'footwear' && /sneaker|trainer/i.test(g.name)) score -= 0.5;
    if (g.pattern !== 'solid') score -= 0.2;
  }
  return round1(clamp(score, 0, 10));
}

export function scoreOutfit(garments: Garment[], ctx: OutfitContext = {}): Outfit['metrics'] {
  const colorHarmony = Math.round(colorHarmonyScore(garments.flatMap((g) => [g.mainColor, ...g.secondaryColors])));
  const estimatedWarmth = estimateOutfitWarmth(garments);
  const formality = estimateFormality(garments);
  return { colorHarmony, estimatedWarmth, formality };
}

export interface GarmentAvailability {
  garment: Garment;
  available: boolean;
  reason?: string;
}

export function garmentAvailability(g: Garment): GarmentAvailability {
  if (g.laundryStatus === 'in-wash' || g.laundryStatus === 'drying') {
    return { garment: g, available: false, reason: 'In the laundry' };
  }
  if (g.laundryStatus === 'needs-wash') {
    return { garment: g, available: false, reason: 'Needs washing' };
  }
  if (g.wearsSinceWash >= g.maxWearsBeforeWash) {
    return { garment: g, available: false, reason: 'Reached max wears before wash' };
  }
  return { garment: g, available: true };
}

export interface OutfitCandidateScore {
  garments: Garment[];
  metrics: Outfit['metrics'];
  totalScore: number;
  warnings: string[];
}

/**
 * Rank a candidate set of garments (one combination) against context +
 * learned preferences. Higher totalScore is better. This never calls any
 * network/AI service -- it is the deterministic fallback and baseline used
 * everywhere, including when Gemini is configured, to re-rank its proposals.
 */
export function evaluateOutfitCandidate(garments: Garment[], ctx: OutfitContext = {}): OutfitCandidateScore {
  const warnings: string[] = [];
  const metrics = scoreOutfit(garments, ctx);
  let score = metrics.colorHarmony * 0.4;

  if (ctx.weatherTempC !== undefined) {
    const bias = ctx.warmthBias ?? 0;
    // Rough mapping: comfortable warmth ~ (20 - tempC) / 2, clamped 0-10.
    const targetWarmth = clamp((20 - ctx.weatherTempC) / 2 + bias, 0, 10);
    const diff = Math.abs(metrics.estimatedWarmth - targetWarmth);
    score += clamp(40 - diff * 8, 0, 40);
    if (diff > 3) warnings.push(`May feel ${metrics.estimatedWarmth < targetWarmth ? 'too cold' : 'too warm'} for ${ctx.weatherTempC}°C`);
  } else {
    score += 20;
  }

  if (ctx.precipitationChance && ctx.precipitationChance > 0.4) {
    const hasWaterproof = garments.some((g) => g.features.waterproof);
    if (hasWaterproof) score += 10;
    else warnings.push('Rain likely and no waterproof layer selected');
  }

  const ratings = garments.map((g) => g.rating).filter((r): r is number => !!r);
  if (ratings.length) score += (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 4;

  const unavailable = garments.map(garmentAvailability).filter((a) => !a.available);
  if (unavailable.length) {
    score -= unavailable.length * 25;
    unavailable.forEach((u) => warnings.push(`${u.garment.name}: ${u.reason}`));
  }

  return { garments, metrics, totalScore: round1(score), warnings };
}

/** Generate & rank whole-outfit candidates from the wardrobe using simple
 * category-slot combination (base top + base bottom + footwear [+ outer
 * layer if cold/rainy] [+ headwear/accessories if requested]). This is the
 * local engine used when Gemini is unavailable, and to validate/re-rank
 * Gemini's textual proposals against real wardrobe data. */
export function recommendOutfits(
  wardrobe: Garment[],
  ctx: OutfitContext & { mustIncludeIds?: string[]; mustExcludeIds?: string[]; maxResults?: number } = {}
): OutfitCandidateScore[] {
  const exclude = new Set(ctx.mustExcludeIds ?? []);
  // A garment marked for washing must never reach any generated candidate.
  // Keep this guard here as well as in the picker UI so every caller agrees.
  const pool = wardrobe.filter((g) => !exclude.has(g.id) && garmentAvailability(g).available);
  const by = (cat: Garment['category']) => pool.filter((g) => g.category === cat);
  const tops = by('tops');
  const bottoms = by('bottoms');
  const footwear = by('footwear');
  const outerwear = by('outerwear');
  const headwear = by('headwear');

  const wantsOuter = (ctx.weatherTempC ?? 15) < 12 || (ctx.precipitationChance ?? 0) > 0.4;
  const wantsHead = (ctx.weatherTempC ?? 15) < 5;
  // On cold or wet days, every generated combination includes an outer layer
  // when one is available. Try the warmest pieces first so a low-warmth base
  // outfit is lifted by the strongest suitable layer.
  const outerOptions: (Garment | undefined)[] = wantsOuter && outerwear.length
    ? [...outerwear].sort((a, b) => b.warmthScore - a.warmthScore)
    : [undefined];

  const results: OutfitCandidateScore[] = [];
  for (const top of tops.length ? tops : [undefined]) {
    for (const bottom of bottoms.length ? bottoms : [undefined]) {
      for (const shoe of footwear.length ? footwear : [undefined]) {
        const combos = outerOptions.map((outer) => outer ? [outer] : []);
        for (const extra of combos) {
          const set = [top, bottom, shoe, ...(wantsHead && headwear.length ? [headwear[0]] : []), ...extra].filter(
            (g): g is Garment => !!g
          );
          if (set.length === 0) continue;
          if (ctx.mustIncludeIds?.length && !ctx.mustIncludeIds.every((id) => set.some((g) => g.id === id))) continue;
          results.push(evaluateOutfitCandidate(set, ctx));
        }
      }
    }
  }
  results.sort((a, b) => b.totalScore - a.totalScore);
  // de-duplicate identical garment sets
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const key = r.garments.map((g) => g.id).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, ctx.maxResults ?? 6);
}

/** Apply "mark outfit as worn" side-effects to garments (pure transform -- caller persists). */
export function applyWearToGarments(garments: Garment[], outfitGarmentIds: Set<string>): Garment[] {
  const now = nowIso();
  return garments.map((g) => {
    if (!outfitGarmentIds.has(g.id)) return g;
    const wearsSinceWash = g.wearsSinceWash + 1;
    const needsWash = wearsSinceWash >= g.maxWearsBeforeWash;
    return {
      ...g,
      wearsSinceWash,
      lastWornAt: now,
      laundryStatus: needsWash ? 'needs-wash' : g.laundryStatus === 'clean' ? 'worn' : g.laundryStatus,
      updatedAt: now
    };
  });
}

// =========================== LAUNDRY ==========================================

export interface CareConflict {
  garmentA: Garment;
  garmentB: Garment;
  issue: string;
}

export function findCareConflicts(garments: Garment[]): CareConflict[] {
  const conflicts: CareConflict[] = [];
  for (let i = 0; i < garments.length; i++) {
    for (let j = i + 1; j < garments.length; j++) {
      const a = garments[i];
      const b = garments[j];
      if (a.careLabel.dryCleanOnly !== b.careLabel.dryCleanOnly && (a.careLabel.dryCleanOnly || b.careLabel.dryCleanOnly)) {
        conflicts.push({ garmentA: a, garmentB: b, issue: 'One item is dry-clean only' });
        continue;
      }
      if (a.careLabel.handWashOnly !== b.careLabel.handWashOnly && (a.careLabel.handWashOnly || b.careLabel.handWashOnly)) {
        conflicts.push({ garmentA: a, garmentB: b, issue: 'One item is hand-wash only' });
        continue;
      }
      const maxA = a.careLabel.maxWashTempC ?? 60;
      const maxB = b.careLabel.maxWashTempC ?? 60;
      if (Math.abs(maxA - maxB) >= 20) {
        conflicts.push({ garmentA: a, garmentB: b, issue: `Care labels suggest different wash temperatures (${maxA}°C vs ${maxB}°C)` });
      }
    }
  }
  return conflicts;
}

/** Conservative, care-label-first wash recommendation for a group. Never
 * exceeds the lowest max temperature or loosens a hand-wash/dry-clean-only
 * restriction present in the group. */
export function recommendWashSettings(garments: Garment[]): Pick<LaundryGroup, 'washTempC' | 'cycle' | 'spin' | 'dryingRecommendation'> {
  if (garments.length === 0) {
    return { washTempC: 30, cycle: 'normal', spin: 'medium', dryingRecommendation: 'line-dry' };
  }
  const anyDryClean = garments.some((g) => g.careLabel.dryCleanOnly);
  const anyHandWash = garments.some((g) => g.careLabel.handWashOnly);
  const minMaxTemp = Math.min(...garments.map((g) => g.careLabel.maxWashTempC ?? 60));
  const anyDelicate = garments.some((g) => g.careLabel.handWashOnly || minMaxTemp <= 30);
  const anyNoTumble = garments.some((g) => g.careLabel.noTumbleDry);

  return {
    washTempC: clamp(minMaxTemp, 20, 60),
    cycle: anyDryClean ? 'dry-clean (take to cleaner)' : anyHandWash ? 'hand wash' : anyDelicate ? 'delicate' : 'normal',
    spin: anyDelicate ? 'low' : 'medium',
    dryingRecommendation: anyNoTumble || anyDelicate ? 'line-dry' : 'tumble-low'
  };
}

export function completeWash(garments: Garment[], groupGarmentIds: Set<string>): Garment[] {
  const now = nowIso();
  return garments.map((g) => {
    if (!groupGarmentIds.has(g.id)) return g;
    return { ...g, wearsSinceWash: 0, laundryStatus: 'clean', laundryGroupId: null, updatedAt: now };
  });
}

// =========================== FOOD / EXPIRATION ================================

export type ExpiryRisk = 'expired' | 'soon' | 'ok' | 'unknown';

export function expiryRisk(item: FoodItem, soonThresholdDays = 3): ExpiryRisk {
  if (!item.expirationDate) return 'unknown';
  const d = daysUntil(item.expirationDate);
  if (d === null) return 'unknown';
  if (d < 0) return 'expired';
  if (d <= soonThresholdDays) return 'soon';
  return 'ok';
}

export function isSafeToConsume(item: FoodItem): boolean {
  // Conservative: a "use-by" date that has passed is never flagged safe.
  // A "best-before" date that has passed is a quality (not safety) signal,
  // so we surface it but do not assert safety either way -- the user decides.
  if (!item.expirationDate) return true;
  const overdue = (daysUntil(item.expirationDate) ?? 0) < 0;
  if (!overdue) return true;
  return item.dateCertainty !== 'use-by';
}

export function getExpiringFoodItems(items: FoodItem[], withinDays = 3): FoodItem[] {
  return items.filter((i) => {
    const d = daysUntil(i.expirationDate);
    return d !== null && d <= withinDays;
  });
}

// =========================== MEALS / INGREDIENTS ================================

function normalizeUnit(u: string): string {
  const s = u.trim().toLowerCase();
  if (['g', 'gram', 'grams'].includes(s)) return 'g';
  if (['kg', 'kilogram', 'kilograms'].includes(s)) return 'kg';
  if (['ml', 'milliliter', 'milliliters', 'millilitre'].includes(s)) return 'ml';
  if (['l', 'liter', 'liters', 'litre'].includes(s)) return 'l';
  if (['pcs', 'piece', 'pieces', 'pc'].includes(s)) return 'pcs';
  return s;
}

function convertToComparable(qty: number, unit: string): { qty: number; unit: string } {
  const u = normalizeUnit(unit);
  if (u === 'kg') return { qty: qty * 1000, unit: 'g' };
  if (u === 'l') return { qty: qty * 1000, unit: 'ml' };
  return { qty, unit: u };
}

export function checkIngredientAvailability(ingredient: Ingredient, inventory: FoodItem[]): AvailabilityStatus {
  const matches = inventory.filter((f) => f.name.trim().toLowerCase() === ingredient.name.trim().toLowerCase());
  if (matches.length === 0) return 'red';
  const need = convertToComparable(ingredient.quantity, ingredient.unit);
  const have = matches.reduce((sum, f) => {
    const c = convertToComparable(f.quantity * f.estimatedRemainingFraction, f.unit);
    return c.unit === need.unit ? sum + c.qty : sum + (f.estimatedRemainingFraction > 0 ? f.quantity : 0);
  }, 0);
  if (need.unit !== normalizeUnit(matches[0].unit) && have === 0) {
    // Units not directly comparable (e.g. "bag" vs "g") -- treat presence as amber (uncertain).
    return 'amber';
  }
  if (have <= 0) return 'red';
  if (have < need.qty) return 'amber';
  return 'green';
}

export interface RecipeAvailability {
  recipe: Recipe;
  perIngredient: Record<string, AvailabilityStatus>;
  overall: AvailabilityStatus;
}

export function evaluateRecipeAvailability(recipe: Recipe, inventory: FoodItem[]): RecipeAvailability {
  const perIngredient: Record<string, AvailabilityStatus> = {};
  for (const ing of recipe.ingredients) {
    perIngredient[ing.id] = checkIngredientAvailability(ing, inventory);
  }
  const statuses = Object.values(perIngredient);
  const overall: AvailabilityStatus = statuses.includes('red') ? 'red' : statuses.includes('amber') ? 'amber' : 'green';
  return { recipe, perIngredient, overall };
}

export function rankRecipeSuggestions(recipes: Recipe[], inventory: FoodItem[]): (RecipeAvailability & { score: number })[] {
  return recipes
    .map((r) => {
      const av = evaluateRecipeAvailability(r, inventory);
      const greenCount = Object.values(av.perIngredient).filter((s) => s === 'green').length;
      const total = Math.max(1, r.ingredients.length);
      let score = (greenCount / total) * 70;
      // prioritise recipes that use soon-expiring ingredients
      const usesExpiring = r.ingredients.some((ing) =>
        inventory.some((f) => f.name.toLowerCase() === ing.name.toLowerCase() && expiryRisk(f) === 'soon')
      );
      if (usesExpiring) score += 20;
      if (r.prepMinutes && r.prepMinutes <= 20) score += 10;
      return { ...av, score: round1(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Consume a recipe's ingredients from inventory (pure transform). Only call
 * this after explicit user confirmation of meal preparation. */
export function consumeIngredients(inventory: FoodItem[], ingredients: Ingredient[]): FoodItem[] {
  const now = nowIso();
  let next = [...inventory];
  for (const ing of ingredients) {
    const need = convertToComparable(ing.quantity, ing.unit);
    next = next.map((f) => {
      if (f.name.trim().toLowerCase() !== ing.name.trim().toLowerCase()) return f;
      const have = convertToComparable(f.quantity * f.estimatedRemainingFraction, f.unit);
      if (have.unit !== need.unit) return f;
      const remainingQty = Math.max(0, have.qty - need.qty);
      const fraction = f.quantity > 0 ? clamp(remainingQty / (have.unit === 'g' || have.unit === 'ml' ? convertToComparable(f.quantity, f.unit).qty : f.quantity), 0, 1) : 0;
      need.qty = Math.max(0, need.qty - have.qty);
      return { ...f, estimatedRemainingFraction: fraction, updatedAt: now };
    });
  }
  return next;
}

// =========================== SHOPPING LIST RECONCILIATION ======================

export function reconcileShoppingList(
  recipes: Recipe[],
  recipeIdsNeeded: string[],
  inventory: FoodItem[],
  existing: ShoppingItem[]
): ShoppingItem[] {
  const now = nowIso();
  const next = [...existing];
  const existingKey = (name: string, reason: string) => `${name.toLowerCase()}::${reason}`;
  const existingKeys = new Set(next.filter((i) => !i.purchased).map((i) => existingKey(i.name, i.reason)));

  for (const recipeId of recipeIdsNeeded) {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const status = checkIngredientAvailability(ing, inventory);
      if (status === 'green') continue;
      const key = existingKey(ing.name, 'recipe');
      if (existingKeys.has(key)) continue;
      next.push({
        id: newId(),
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        purchased: false,
        reason: 'recipe',
        linkedRecipeId: recipe.id,
        priceSource: 'unknown',
        createdAt: now,
        updatedAt: now
      });
      existingKeys.add(key);
    }
  }

  // Foods running low (estimated remaining < 20%)
  for (const f of inventory) {
    if (f.estimatedRemainingFraction > 0.2) continue;
    const key = existingKey(f.name, 'low-stock');
    if (existingKeys.has(key)) continue;
    next.push({
      id: newId(),
      name: f.name,
      quantity: f.quantity,
      unit: f.unit,
      purchased: false,
      reason: 'low-stock',
      linkedFoodItemId: f.id,
      priceSource: 'unknown',
      createdAt: now,
      updatedAt: now
    });
    existingKeys.add(key);
  }

  return next;
}

// =========================== CALENDAR: RECURRENCE EXPANSION & CLASHES =========

export interface ExpandedEvent {
  event: CalendarEvent;
  start: Date;
  end: Date;
}

export function expandEventOccurrences(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): ExpandedEvent[] {
  const duration = new Date(event.end).getTime() - new Date(event.start).getTime();
  const out: ExpandedEvent[] = [];
  if (event.recurrence.freq === 'none') {
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (areIntervalsOverlapping({ start, end }, { start: rangeStart, end: rangeEnd }, { inclusive: true })) {
      out.push({ event, start, end });
    }
    return out;
  }
  let cursor: Date | null = new Date(event.start);
  let guard = 0;
  while (cursor && cursor <= rangeEnd && guard < 2000) {
    guard += 1;
    if (cursor >= rangeStart) {
      out.push({ event, start: new Date(cursor), end: new Date(cursor.getTime() + duration) });
    }
    cursor = nextOccurrence(cursor.toISOString(), event.recurrence, cursor);
  }
  return out;
}

export interface Clash {
  a: ExpandedEvent;
  b: ExpandedEvent;
}

export function detectClashes(events: CalendarEvent[], rangeStart: Date, rangeEnd: Date): Clash[] {
  const expanded = events.flatMap((e) => expandEventOccurrences(e, rangeStart, rangeEnd));
  const clashes: Clash[] = [];
  for (let i = 0; i < expanded.length; i++) {
    for (let j = i + 1; j < expanded.length; j++) {
      const a = expanded[i];
      const b = expanded[j];
      if (a.event.id === b.event.id) continue;
      if (areIntervalsOverlapping({ start: a.start, end: a.end }, { start: b.start, end: b.end })) {
        clashes.push({ a, b });
      }
    }
  }
  return clashes;
}

// =========================== TASK GROUPING ======================================

export interface TaskGroup {
  key: string;
  label: string;
  tasks: Task[];
  relatedEvents: CalendarEvent[];
}

export function groupTasks(tasks: Task[], events: CalendarEvent[], locationTags: Record<string, string> = {}): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  const addTo = (key: string, label: string, task: Task, related: CalendarEvent[] = []) => {
    const g = groups.get(key) ?? { key, label, tasks: [], relatedEvents: [] };
    g.tasks.push(task);
    related.forEach((e) => {
      if (!g.relatedEvents.some((x) => x.id === e.id)) g.relatedEvents.push(e);
    });
    groups.set(key, g);
  };

  const locations = new Map<string, { label: string; tasks: Task[]; events: CalendarEvent[] }>();
  const categories = new Map<string, Task[]>();
  const keyForPlace = (place: string) => place.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const eventPlace = (event: CalendarEvent) => event.location || (event.locationTag ? locationTags[event.locationTag] : undefined);
  for (const task of tasks) {
    if (task.completed) continue;
    const linked = task.linkedCalendarEventId ? events.find((event) => event.id === task.linkedCalendarEventId) : undefined;
    const place = task.location || (task.locationTag ? locationTags[task.locationTag] : undefined) || (linked ? eventPlace(linked) : undefined);
    if (place?.trim()) {
      const key = keyForPlace(place);
      const bucket = locations.get(key) ?? { label: place, tasks: [], events: [] };
      bucket.tasks.push(task);
      if (linked && !bucket.events.some((event) => event.id === linked.id)) bucket.events.push(linked);
      events.filter((event) => eventPlace(event) && keyForPlace(eventPlace(event)!) === key).forEach((event) => {
        if (!bucket.events.some((existing) => existing.id === event.id)) bucket.events.push(event);
      });
      locations.set(key, bucket);
    } else {
      const bucket = categories.get(task.category) ?? [];
      bucket.push(task);
      categories.set(task.category, bucket);
    }
  }
  for (const [category, group] of categories) {
    const title = category.charAt(0).toUpperCase() + category.slice(1);
    group.forEach((task) => addTo(`cat:${category}`, title, task));
  }
  for (const [key, bucket] of locations) {
    if (bucket.tasks.length > 1) bucket.tasks.forEach((task) => addTo(`loc:${key}`, bucket.label, task, bucket.events));
  }

  return Array.from(groups.values()).sort((a, b) => b.tasks.length - a.tasks.length);
}

// =========================== SMART SHOPPING: ROUTE-STOP OPTIMISATION ===========

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minimum distance from a point to a polyline (route geometry), in metres. */
export function distanceToRoute(point: GeoPoint, route: GeoPoint[]): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return haversineMeters(point, route[0]);
  let min = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    min = Math.min(min, pointToSegmentMeters(point, route[i], route[i + 1]));
  }
  return min;
}

function pointToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  // Approximate using an equirectangular projection local to the segment --
  // adequate for short urban/suburban route segments used in this prototype.
  const toXY = (pt: GeoPoint, ref: GeoPoint) => ({
    x: ((pt.lon - ref.lon) * Math.PI * 6371000 * Math.cos((ref.lat * Math.PI) / 180)) / 180,
    y: ((pt.lat - ref.lat) * Math.PI * 6371000) / 180
  });
  const ref = a;
  const A = toXY(a, ref);
  const B = toXY(b, ref);
  const P = toXY(p, ref);
  const ABx = B.x - A.x;
  const ABy = B.y - A.y;
  const lenSq = ABx * ABx + ABy * ABy || 1e-9;
  let t = ((P.x - A.x) * ABx + (P.y - A.y) * ABy) / lenSq;
  t = clamp(t, 0, 1);
  const closest = { x: A.x + ABx * t, y: A.y + ABy * t };
  return Math.sqrt((P.x - closest.x) ** 2 + (P.y - closest.y) ** 2);
}

export function filterStoresNearRoute(stores: StoreCandidate[], route: GeoPoint[], corridorWidthMeters: number): StoreCandidate[] {
  return stores
    .map((s) => ({ ...s, distanceFromRouteMeters: distanceToRoute(s.point, route) }))
    .filter((s) => s.distanceFromRouteMeters <= corridorWidthMeters)
    .sort((a, b) => a.distanceFromRouteMeters - b.distanceFromRouteMeters);
}

/** Split shopping items between the ranked store candidates. Greedy: assign
 * all items to the closest store up to a max item count per stop, overflow
 * goes to the next closest, to avoid unnecessary detours/repeated stops. */
export function allocateItemsToStores(
  items: ShoppingItem[],
  rankedStores: StoreCandidate[],
  maxStops = 2,
  maxItemsPerStop = 12
): Record<string, string[]> {
  const allocation: Record<string, string[]> = {};
  const stops = rankedStores.slice(0, maxStops);
  if (stops.length === 0) return allocation;
  let idx = 0;
  for (const item of items) {
    // simple round-robin fill respecting per-stop cap, preferring earlier (closer) stops
    let placed = false;
    for (let attempt = 0; attempt < stops.length; attempt++) {
      const stop = stops[(idx + attempt) % stops.length];
      const list = allocation[stop.id] ?? [];
      if (list.length < maxItemsPerStop) {
        allocation[stop.id] = [...list, item.id];
        placed = true;
        break;
      }
    }
    if (!placed) {
      const last = stops[stops.length - 1];
      allocation[last.id] = [...(allocation[last.id] ?? []), item.id];
    }
    idx += 1;
  }
  return allocation;
}

// =========================== ICS (calendar import/export) =====================

function foldIcsLine(line: string): string {
  // RFC5545 line folding at 75 octets is ideal but most consumers tolerate
  // unfolded lines; we keep it simple for this prototype.
  return line;
}

export function eventsToIcs(events: CalendarEvent[]): string {
  const fmt = (iso: string) => iso.replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudentDailyPlanner//EN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@student-daily-planner`);
    lines.push(foldIcsLine(`SUMMARY:${e.title.replace(/\n/g, ' ')}`));
    if (e.description) lines.push(foldIcsLine(`DESCRIPTION:${e.description.replace(/\n/g, ' ')}`));
    if (e.location) lines.push(foldIcsLine(`LOCATION:${e.location.replace(/\n/g, ' ')}`));
    lines.push(`DTSTART:${fmt(e.start)}`);
    lines.push(`DTEND:${fmt(e.end)}`);
    if (e.recurrence.freq !== 'none') {
      const freq = e.recurrence.freq.toUpperCase();
      lines.push(`RRULE:FREQ=${freq};INTERVAL=${e.recurrence.interval}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function icsToEvents(ics: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const blocks = ics.split('BEGIN:VEVENT').slice(1);
  const parseDate = (v: string): string => {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (!m) return new Date().toISOString();
    const [, y, mo, d, h, mi, s] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  };
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const get = (key: string) => {
      const m = body.match(new RegExp(`${key}[^:]*:(.*)`));
      return m ? m[1].trim() : undefined;
    };
    const start = get('DTSTART');
    const end = get('DTEND');
    if (!start) continue;
    const rrule = get('RRULE');
    let recurrence: Recurrence = { freq: 'none', interval: 1 };
    if (rrule) {
      const freqMatch = rrule.match(/FREQ=([A-Z]+)/);
      const intervalMatch = rrule.match(/INTERVAL=(\d+)/);
      const freqMap: Record<string, Recurrence['freq']> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' };
      if (freqMatch && freqMap[freqMatch[1]]) {
        recurrence = { freq: freqMap[freqMatch[1]], interval: intervalMatch ? parseInt(intervalMatch[1], 10) : 1 };
      }
    }
    events.push({
      id: newId(),
      title: get('SUMMARY') ?? 'Imported event',
      description: get('DESCRIPTION'),
      location: get('LOCATION'),
      start: parseDate(start),
      end: end ? parseDate(end) : addDays(new Date(parseDate(start)), 0).toISOString(),
      allDay: false,
      recurrence,
      category: 'other',
      reminderMinutesBefore: [],
      externalSource: 'ics-import',
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  return events;
}

export function isWithinRange(iso: string, start: Date, end: Date): boolean {
  return isWithinInterval(new Date(iso), { start, end });
}
