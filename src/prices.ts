import type { ShoppingItem } from './types';
import { aiCacheGet, aiCacheSet } from './db';

const PRICE_DATA_URL = 'https://api.apify.com/v2/datasets/ynAT9NPps2EdjMOJa/items?format=json&limit=1000';
const CACHE_KEY = 'uk-grocery-price-snapshot-v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface GroceryPriceRow {
  retailer: string;
  name: string;
  price: number;
  loyaltyPrice?: number | null;
  packSize?: string;
  scrapedAt?: string;
  url?: string;
  promotionText?: string | null;
}
export interface BasketRetailerTotal {
  retailer: string;
  total: number;
  matched: number;
  totalItems: number;
  pricedItems: Array<{ itemId: string; itemName: string; price: number; productName: string; productUrl?: string }>;
}

async function loadSnapshot(): Promise<GroceryPriceRow[]> {
  const cached = await aiCacheGet<{ savedAt: number; rows: GroceryPriceRow[] }>(CACHE_KEY);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.rows;
  const response = await fetch(PRICE_DATA_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Grocery price feed returned HTTP ${response.status}`);
  const json = await response.json();
  const rows = (Array.isArray(json) ? json : json.items ?? []).filter((row: any) =>
    row && typeof row.retailer === 'string' && typeof row.name === 'string' && Number.isFinite(Number(row.price)) && Number(row.price) > 0
  ) as GroceryPriceRow[];
  if (!rows.length) throw new Error('No grocery prices were returned by the public daily feed.');
  await aiCacheSet(CACHE_KEY, { savedAt: Date.now(), rows });
  return rows;
}

function itemTerms(name: string): string[] {
  const key = name.toLowerCase();
  if (/tomato/.test(key)) return ['tomato'];
  if (/spinach/.test(key)) return ['spinach'];
  if (/milk/.test(key)) return ['milk'];
  if (/bread/.test(key)) return ['bread'];
  if (/egg/.test(key)) return ['egg'];
  if (/cheese/.test(key)) return ['cheddar', 'cheese'];
  if (/chicken/.test(key)) return key.includes('pasta') ? ['chicken pasta'] : ['chicken breast', 'chicken'];
  if (/cream/.test(key)) return ['cream'];
  if (/pasta/.test(key)) return ['pasta'];
  if (/oat|porridge/.test(key)) return ['oat', 'porridge', 'cereal'];
  return [key.replace(/[^a-z0-9 ]/g, '').trim()];
}

function matchesItem(item: ShoppingItem, row: GroceryPriceRow): boolean {
  const name = row.name.toLowerCase();
  const terms = itemTerms(item.name);
  if (terms[0] === 'chicken pasta') return name.includes('chicken') && name.includes('pasta');
  return terms.some((term) => name.includes(term));
}

function priceFor(row: GroceryPriceRow): number {
  const shelf = Number(row.price);
  const loyalty = Number(row.loyaltyPrice);
  return Number.isFinite(loyalty) && loyalty > 0 ? Math.min(shelf, loyalty) : shelf;
}

function quantityMultiplier(item: ShoppingItem, row: GroceryPriceRow): number {
  if (!['g', 'kg', 'ml', 'l'].includes(item.unit.toLowerCase())) return Math.max(1, Math.ceil(item.quantity));
  const size = row.packSize?.toLowerCase().match(/([\d.]+)\s*(kg|g|ml|l)/);
  if (!size) return 1;
  let pack = Number(size[1]);
  if (size[2] === 'kg' || size[2] === 'l') pack *= 1000;
  const need = item.unit.toLowerCase() === 'kg' || item.unit.toLowerCase() === 'l' ? item.quantity * 1000 : item.quantity;
  return Math.max(1, Math.ceil(need / pack));
}

export async function compareUkBasket(items: ShoppingItem[]): Promise<{ totals: BasketRetailerTotal[]; priceByItem: Record<string, number>; latestAt: string | null }> {
  const rows = await loadSnapshot();
  const retailers = [...new Set(rows.map((row) => row.retailer))];
  const totals: BasketRetailerTotal[] = retailers.map((retailer) => {
    const availableRows = rows.filter((row) => row.retailer === retailer);
    const pricedItems: BasketRetailerTotal['pricedItems'] = [];
    for (const item of items) {
      const best = availableRows.filter((row) => matchesItem(item, row)).sort((a, b) => priceFor(a) - priceFor(b))[0];
      if (best) pricedItems.push({ itemId: item.id, itemName: item.name, price: priceFor(best) * quantityMultiplier(item, best), productName: best.name, productUrl: best.url });
    }
    return { retailer, total: pricedItems.reduce((sum, row) => sum + row.price, 0), matched: pricedItems.length, totalItems: items.length, pricedItems };
  }).filter((retailer) => retailer.matched > 0).sort((a, b) => a.total - b.total);
  const priceByItem: Record<string, number> = {};
  for (const item of items) {
    const quotes = totals.flatMap((retailer) => retailer.pricedItems.filter((line) => line.itemId === item.id).map((line) => line.price));
    if (quotes.length) priceByItem[item.id] = Math.min(...quotes);
  }
  const timestamps = rows.map((row) => row.scrapedAt).filter((v): v is string => !!v).sort();
  return { totals, priceByItem, latestAt: timestamps[timestamps.length - 1] ?? null };
}
