// ---------------------------------------------------------------------------
// IndexedDB persistence layer (via `idb`). This is the ONLY module that talks
// to IndexedDB directly -- UI components and the state layer (`context.tsx`)
// go through the typed `*Store` repositories and helper functions exported
// here, never through `getDb()` themselves (except `wipeAllData`/seeding).
//
// Image blobs are stored in their own object store, keyed by a `blobKey`
// string referenced from records (Garment.images[].blobKey, FoodItem.image,
// etc.) -- never as temporary-only object URLs, per the spec.
// ---------------------------------------------------------------------------
import { openDB, type IDBPDatabase } from 'idb';
import type {
  Garment, Outfit, OutfitFeedback, LaundryGroup, WashRecord, FoodItem, Recipe, MealPlan,
  ShoppingItem, CalendarEvent, Task, Reminder
} from './types';

const DB_NAME = 'student-daily-planner';
const DB_VERSION = 1;

const RECORD_STORES = [
  'garments', 'outfits', 'outfitFeedback', 'laundryGroups', 'washRecords',
  'foodItems', 'recipes', 'mealPlans', 'shoppingItems', 'calendarEvents', 'tasks', 'reminders'
] as const;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of RECORD_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('aiCache')) db.createObjectStore('aiCache');
      }
    });
  }
  return dbPromise;
}

// ---------- Generic typed record repository ---------------------------------------

export interface Repository<T extends { id: string }> {
  all: () => Promise<T[]>;
  get: (id: string) => Promise<T | undefined>;
  put: (value: T) => Promise<void>;
  putMany: (values: T[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function makeRepository<T extends { id: string }>(storeName: (typeof RECORD_STORES)[number]): Repository<T> {
  return {
    async all() {
      const db = await getDb();
      return db.getAll(storeName);
    },
    async get(id: string) {
      const db = await getDb();
      return db.get(storeName, id);
    },
    async put(value: T) {
      const db = await getDb();
      await db.put(storeName, value);
    },
    async putMany(values: T[]) {
      if (values.length === 0) return;
      const db = await getDb();
      const tx = db.transaction(storeName, 'readwrite');
      await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
    },
    async remove(id: string) {
      const db = await getDb();
      await db.delete(storeName, id);
    }
  };
}

export const garmentsStore = makeRepository<Garment>('garments');
export const outfitsStore = makeRepository<Outfit>('outfits');
export const outfitFeedbackStore = makeRepository<OutfitFeedback>('outfitFeedback');
export const laundryGroupsStore = makeRepository<LaundryGroup>('laundryGroups');
export const washRecordsStore = makeRepository<WashRecord>('washRecords');
export const foodItemsStore = makeRepository<FoodItem>('foodItems');
export const recipesStore = makeRepository<Recipe>('recipes');
export const mealPlansStore = makeRepository<MealPlan>('mealPlans');
export const shoppingItemsStore = makeRepository<ShoppingItem>('shoppingItems');
export const calendarEventsStore = makeRepository<CalendarEvent>('calendarEvents');
export const tasksStore = makeRepository<Task>('tasks');
export const remindersStore = makeRepository<Reminder>('reminders');

// ---------- Key/value settings store (preferences, settings, seed flag) -----------

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return db.get('kv', key);
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('kv', value, key);
}

// ---------- Image blobs --------------------------------------------------------------
// Original photographs are preserved; derived crops/thumbnails are stored as
// separate blobKey entries so the original is never overwritten.

export async function saveImageBlob(blobKey: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('images', blob, blobKey);
}

export async function getImageBlob(blobKey: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('images', blobKey);
}

export async function deleteImageBlob(blobKey: string): Promise<void> {
  const db = await getDb();
  await db.delete('images', blobKey);
}

export async function getAllImageKeys(): Promise<string[]> {
  const db = await getDb();
  return (await db.getAllKeys('images')) as string[];
}

// Object URLs are cached per blobKey so repeated renders of the same image
// (e.g. a garment card re-rendering) don't leak multiple URLs; callers do not
// need to revoke them individually -- `revokeAllImageObjectUrls()` is called
// on data reset/import.
const objectUrlCache = new Map<string, string>();

export async function getImageObjectUrl(blobKey: string): Promise<string | null> {
  const cached = objectUrlCache.get(blobKey);
  if (cached) return cached;
  const blob = await getImageBlob(blobKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(blobKey, url);
  return url;
}

export function revokeAllImageObjectUrls(): void {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url);
  objectUrlCache.clear();
}

// ---------- AI / network result cache -------------------------------------------------
// Used to avoid redundant Gemini calls and to respect public API rate limits
// (Open Food Facts, Photon, OSRM, Overpass) by caching their responses.

export async function aiCacheGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const entry = await db.get('aiCache', key);
  if (!entry) return undefined;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    await db.delete('aiCache', key);
    return undefined;
  }
  return entry.value as T;
}

export async function aiCacheSet<T>(key: string, value: T, ttlMs = 1000 * 60 * 60 * 24): Promise<void> {
  const db = await getDb();
  await db.put('aiCache', { value, expiresAt: Date.now() + ttlMs }, key);
}

/** Small, fast, non-cryptographic string hash used only to build stable
 * cache keys (e.g. from a base64 image payload) -- not used for security. */
export async function hashKey(input: string): Promise<string> {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + input.length.toString(36);
}

// ---------- Full reset (used by "Reset all data" in Settings) -----------------------

export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  const stores = [...RECORD_STORES, 'images', 'aiCache'] as const;
  await Promise.all(
    stores.map(async (name) => {
      const tx = db.transaction(name, 'readwrite');
      await tx.store.clear();
      await tx.done;
    })
  );
  revokeAllImageObjectUrls();
  // Note: the 'kv' store (preferences/settings/seed flag) is intentionally
  // left untouched here -- callers that want a full factory reset also clear
  // the seed flag explicitly so demo data is reseeded.
}
