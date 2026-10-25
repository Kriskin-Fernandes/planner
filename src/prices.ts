import type { ShoppingItem } from './types';
import { newId, nowIso } from './types';
import { aiCacheGet, aiCacheSet } from './db';

const PRICE_DATA_URL = 'https://api.apify.com/v2/datasets/ynAT9NPps2EdjMOJa/items?format=json&limit=1000';
const CACHE_KEY = 'uk-grocery-price-snapshot-v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const WAITROSE_SNAPSHOT_DATE = '2026-10-25T00:00:00.000Z';
const WAITROSE_ROWS: GroceryPriceRow[] = [
  { retailer: 'Waitrose', name: 'Essential British Free Range Semi-Skimmed Milk 4 Pints 2.272litre', price: 1.75, packSize: '2.272l', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/milk_butter_and_eggs' },
  { retailer: 'Waitrose', name: 'Essential British Free Range Semi-Skimmed Milk 2 Pints 1.136litre', price: 1.25, packSize: '1.136l', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/milk_butter_and_eggs' },
  { retailer: 'Waitrose', name: 'Essential Free Range White Eggs 6s', price: 1.40, packSize: '6 pcs', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/milk_butter_and_eggs' },
  { retailer: 'Waitrose', name: 'Essential Free Range Double Cream 300ml', price: 1.80, packSize: '300ml', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/milk_butter_and_eggs' },
  { retailer: 'Waitrose', name: 'Essential Salted Butter 250g', price: 2.00, packSize: '250g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries' },
  { retailer: 'Waitrose', name: 'Essential Basmati Rice 1kg', price: 1.80, packSize: '1kg', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/food_cupboard/rice_pasta_and_pulses' },
  { retailer: 'Waitrose', name: 'Essential Penne 1kg', price: 1.40, packSize: '1kg', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/new_lower_price/food_cupboard/rice_pasta_and_sauces' },
  { retailer: 'Waitrose', name: 'Essential Spaghetti 500g', price: 0.70, packSize: '500g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/food_cupboard/rice_pasta_and_pulses' },
  { retailer: 'Waitrose', name: 'Essential Porridge Oats 1kg', price: 1.00, packSize: '1kg', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/waitrose_brands/essential_waitrose_and_partners/food_cupboard/breakfast_cereals' },
  { retailer: 'Waitrose', name: 'Waitrose Super Soft White Medium Sliced Bread 800g', price: 0.80, packSize: '800g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/new_lower_price' },
  { retailer: 'Waitrose', name: 'Essential British Large Potatoes 4s', price: 0.85, packSize: '4 pcs', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries' },
  { retailer: 'Waitrose', name: 'Waitrose Classic Vine Tomatoes 450g', price: 1.50, packSize: '450g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/fresh_salad_and_herbs' },
  { retailer: 'Waitrose', name: 'Waitrose Baby Spinach 120g', price: 1.10, packSize: '120g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/fresh_salad_and_herbs' },
  { retailer: 'Waitrose', name: 'Essential British Carrots 1kg', price: 0.75, packSize: '1kg', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled' },
  { retailer: 'Waitrose', name: 'Essential Fairtrade Bananas 5s', price: 0.95, packSize: '5 pcs', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled' },
  { retailer: 'Waitrose', name: 'Waitrose Royal Gala Apples 6s', price: 1.80, packSize: '6 pcs', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/fresh_fruit/apples' },
  { retailer: 'Waitrose', name: 'Waitrose Slower Reared Chicken Breast Fillets 600g', price: 5.75, packSize: '600g', scrapedAt: WAITROSE_SNAPSHOT_DATE, url: 'https://www.waitrose.com/ecom/shop/browse/groceries/fresh_and_chilled/fresh_chicken_and_poultry' }
];

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
  shelfTotal: number;
  loyaltySavings: number;
  matched: number;
  totalItems: number;
  pricedItems: Array<{ itemId: string; itemName: string; price: number; shelfPrice: number; loyaltyPrice?: number; loyaltySavings: number; productName: string; productUrl?: string }>;
}

async function loadSnapshot(): Promise<GroceryPriceRow[]> {
  const cached = await aiCacheGet<{ savedAt: number; rows: GroceryPriceRow[] }>(CACHE_KEY);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return [...cached.rows, ...WAITROSE_ROWS];
  try {
    const response = await fetch(PRICE_DATA_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Grocery price feed returned HTTP ${response.status}`);
    const json = await response.json();
    const rows = (Array.isArray(json) ? json : json.items ?? []).filter((row: any) =>
      row && typeof row.retailer === 'string' && typeof row.name === 'string' && Number.isFinite(Number(row.price)) && Number(row.price) > 0
    ) as GroceryPriceRow[];
    if (!rows.length) throw new Error('No grocery prices were returned by the public daily feed.');
    await aiCacheSet(CACHE_KEY, { savedAt: Date.now(), rows });
    return [...rows, ...WAITROSE_ROWS];
  } catch (error) {
    if (WAITROSE_ROWS.length) return WAITROSE_ROWS;
    throw error;
  }
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

const CATALOG_CATEGORIES = [
  { name: 'Milk', terms: ['milk'] }, { name: 'Bread', terms: ['bread', 'loaf'] },
  { name: 'Eggs', terms: ['egg'] }, { name: 'Cheese', terms: ['cheddar', 'cheese'] },
  { name: 'Pasta', terms: ['pasta', 'spaghetti', 'penne'] }, { name: 'Rice', terms: ['rice'] },
  { name: 'Potatoes', terms: ['potato'] }, { name: 'Tomatoes', terms: ['tomato'] },
  { name: 'Spinach', terms: ['spinach'] }, { name: 'Chicken', terms: ['chicken breast', 'chicken'] },
  { name: 'Oats', terms: ['oat', 'porridge'] }, { name: 'Apples', terms: ['apple'] },
  { name: 'Bananas', terms: ['banana'] }, { name: 'Yoghurt', terms: ['yoghurt', 'yogurt'] },
  { name: 'Carrots', terms: ['carrot'] }, { name: 'Butter', terms: ['butter'] },
  { name: 'Cereal', terms: ['cereal', 'corn flakes'] }, { name: 'Coffee', terms: ['coffee'] },
  { name: 'Tea', terms: ['tea bags', 'tea'] }, { name: 'Beans', terms: ['baked beans', 'kidney beans'] }
];

function canonicalRetailer(value: string): string {
  const name = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const chains = ['sainsburys', 'tesco', 'waitrose', 'aldi', 'asda', 'lidl', 'morrisons', 'iceland', 'coop'];
  return chains.find((chain) => name.includes(chain)) ?? name;
}

/** Extra grocery ideas from the live feed, limited to categories priced by at
 * least two distinct chains and excluding anything already on the basket. */
export async function getCatalogueExpansion(items: ShoppingItem[]): Promise<ShoppingItem[]> {
  const rows = await loadSnapshot();
  const existingNames = items.map((item) => item.name.toLowerCase());
  const retailersByCategory = CATALOG_CATEGORIES.map((category) => {
    const matched = rows.filter((row) => {
      const name = row.name.toLowerCase();
      if (/ready meal|chicken pasta|porridge pot|microwave meal|meal deal/.test(name)) return false;
      return category.terms.some((term) => name.includes(term));
    });
    const chains = new Set(matched.map((row) => canonicalRetailer(row.retailer)));
    return { category, chains };
  });
  return retailersByCategory.filter(({ category, chains }) =>
    chains.size > 1 && !existingNames.some((name) => category.terms.some((term) => name.includes(term)))
  ).map(({ category }) => ({
    id: `catalog-${category.name.toLowerCase()}-${newId()}`,
    name: category.name,
    quantity: 1,
    unit: 'pcs',
    purchased: false,
    reason: 'manual',
    estimatedPrice: null,
    priceSource: 'unknown',
    assignedShopId: null,
    assignedShopName: '',
    assignedShopLocation: '',
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
}

export async function compareUkBasket(items: ShoppingItem[]): Promise<{ totals: BasketRetailerTotal[]; priceByItem: Record<string, number>; latestAt: string | null }> {
  const rows = await loadSnapshot();
  const retailers = [...new Set(rows.map((row) => canonicalRetailer(row.retailer)))];
  const totals: BasketRetailerTotal[] = retailers.map((retailer) => {
    const availableRows = rows.filter((row) => canonicalRetailer(row.retailer) === retailer);
    const pricedItems: BasketRetailerTotal['pricedItems'] = [];
    for (const item of items) {
      const best = availableRows.filter((row) => matchesItem(item, row)).sort((a, b) => priceFor(a) - priceFor(b))[0];
      if (best) {
        const multiplier = quantityMultiplier(item, best);
        const shelfPrice = Number(best.price) * multiplier;
        const loyaltyPrice = Number(best.loyaltyPrice);
        const hasLoyaltyPrice = Number.isFinite(loyaltyPrice) && loyaltyPrice > 0 && loyaltyPrice < Number(best.price);
        const effectivePrice = priceFor(best) * multiplier;
        pricedItems.push({ itemId: item.id, itemName: item.name, price: effectivePrice, shelfPrice, ...(hasLoyaltyPrice ? { loyaltyPrice: loyaltyPrice * multiplier } : {}), loyaltySavings: Math.max(0, shelfPrice - effectivePrice), productName: best.name, productUrl: best.url });
      }
    }
    return {
      retailer,
      total: pricedItems.reduce((sum, row) => sum + row.price, 0),
      shelfTotal: pricedItems.reduce((sum, row) => sum + row.shelfPrice, 0),
      loyaltySavings: pricedItems.reduce((sum, row) => sum + row.loyaltySavings, 0),
      matched: pricedItems.length,
      totalItems: items.length,
      pricedItems
    };
  }).filter((retailer) => retailer.matched > 0).sort((a, b) => a.total - b.total);
  const priceByItem: Record<string, number> = {};
  for (const item of items) {
    const quotes = totals.flatMap((retailer) => retailer.pricedItems.filter((line) => line.itemId === item.id).map((line) => line.price));
    if (quotes.length) priceByItem[item.id] = Math.min(...quotes);
  }
  const timestamps = rows.map((row) => row.scrapedAt).filter((v): v is string => !!v).sort();
  return { totals, priceByItem, latestAt: timestamps[timestamps.length - 1] ?? null };
}
