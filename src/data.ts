// ---------------------------------------------------------------------------
// UI constants and demo/seed data. Catalogue images use public Unsplash photo URLs
// and are loaded only when the catalogue is viewed.
// every seeded record is labelled "Demo" in the UI via `isDemo` tracking in
// kv storage, never presented as a real AI result.
// ---------------------------------------------------------------------------
import { newId, nowIso } from './types';
import type {
  Garment,
  Outfit,
  LaundryGroup,
  FoodItem,
  Recipe,
  ShoppingItem,
  CalendarEvent,
  Task
} from './types';
import { addDays, addHours } from 'date-fns';

export const GARMENT_CATEGORIES = ['tops', 'bottoms', 'footwear', 'headwear', 'outerwear', 'accessories', 'other'] as const;

export const GARMENT_CATEGORY_LABELS: Record<string, string> = {
  tops: 'Tops',
  bottoms: 'Bottoms',
  footwear: 'Footwear',
  headwear: 'Headwear',
  outerwear: 'Outerwear',
  accessories: 'Accessories',
  other: 'Other'
};

export const LAYER_ROLE_LABELS: Record<string, string> = {
  base: 'Base layer',
  middle: 'Middle layer',
  outer: 'Outer layer',
  flexible: 'Flexible'
};

export const LAUNDRY_STATUS_LABELS: Record<string, string> = {
  clean: 'Clean',
  worn: 'Worn (not yet dirty)',
  'needs-wash': 'Needs washing',
  'in-wash': 'In the wash',
  drying: 'Drying'
};

export const DEFAULT_LAUNDRY_GROUP_DEFS: { name: string; washTempC: number; cycle: string; spin: LaundryGroup['spin']; dryingRecommendation: LaundryGroup['dryingRecommendation'] }[] = [
  { name: 'Lights', washTempC: 30, cycle: 'normal', spin: 'medium', dryingRecommendation: 'tumble-low' },
  { name: 'Darks', washTempC: 30, cycle: 'normal', spin: 'medium', dryingRecommendation: 'line-dry' },
  { name: 'Denim', washTempC: 40, cycle: 'normal', spin: 'high', dryingRecommendation: 'line-dry' },
  { name: 'Delicates', washTempC: 20, cycle: 'delicate', spin: 'low', dryingRecommendation: 'flat-dry' }
];

export const FOOD_STORAGE_LABELS: Record<string, string> = {
  fridge: 'Fridge',
  freezer: 'Freezer',
  cupboard: 'Cupboard'
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent'
};

export const TASK_PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-200 text-slate-700',
  medium: 'bg-sky-100 text-sky-700',
  high: 'bg-amber-100 text-amber-800',
  urgent: 'bg-rose-100 text-rose-700'
};

// ---------- Remote catalogue images -------------------------------------------

const CLOTHING_PHOTOS: Record<string, string> = {
  'White Tee': new URL('../images/white tee.png', import.meta.url).href,
  'White Long Sleeve': new URL('../images/white long sleeve.png', import.meta.url).href,
  'Pink Shirt': new URL('../images/shirt pink.jpg', import.meta.url).href,
  'Blue Shirt': new URL('../images/shirt blue.jpg', import.meta.url).href,
  'Red Tee': new URL('../images/red tee.png', import.meta.url).href,
  'Purple Tee': new URL('../images/purple tee.png', import.meta.url).href,
  'Mustard Long Sleeve': new URL('../images/mustard long sleeve.png', import.meta.url).href,
  'Light Jeans': new URL('../images/light jeans.jpg', import.meta.url).href,
  'Grey Long Sleeve': new URL('../images/grey long sleeve.png', import.meta.url).href,
  'Green Cargo Trousers': new URL('../images/green cargos.jpg', import.meta.url).href,
  'Dark Jeans': new URL('../images/dark jeans.jpg', import.meta.url).href,
  'Cream Hoodie': new URL('../images/cream hoodie.jpg', import.meta.url).href,
  'Cargo Trousers': new URL('../images/cargos.png', import.meta.url).href,
  'Brown Trousers': new URL('../images/brown pants.png', import.meta.url).href,
  'Blue Zip Up': new URL('../images/blue zip up.jpg', import.meta.url).href,
  'Black Zip Up': new URL('../images/black zip up.jpg', import.meta.url).href,
  'Black Tee': new URL('../images/black tee.jpg', import.meta.url).href,
  'Black Hoodie': new URL('../images/black hoodie.png', import.meta.url).href,
  'Beige Jacket': new URL('../images/beige jacket.jpg', import.meta.url).href
};
const FOOD_PHOTOS: Record<string, string> = {
  Tomato: new URL('../food images/tomato.jpg', import.meta.url).href,
  Spinach: new URL('../food images/spinach.jpg', import.meta.url).href,
  Porridge: new URL('../food images/porridge.jpg', import.meta.url).href,
  Pasta: new URL('../food images/pasta.jpg', import.meta.url).href,
  Oats: new URL('../food images/oats.jpg', import.meta.url).href,
  Milk: new URL('../food images/milk.png', import.meta.url).href,
  'Heavy Cream': new URL('../food images/heavy cream.jpg', import.meta.url).href,
  Eggs: new URL('../food images/eggs.jpg', import.meta.url).href,
  Chicken: new URL('../food images/chicken.png', import.meta.url).href,
  'Chicken Pasta': new URL('../food images/chicken pasta.jpg', import.meta.url).href,
  Cheese: new URL('../food images/cheese.jpg', import.meta.url).href,
  Bread: new URL('../food images/bread.jpg', import.meta.url).href,
  'Wholewheat Bread': new URL('../food images/bread.jpg', import.meta.url).href
};

function img(label: string, url: string, kind: 'original' | 'display' = 'display') {
  return { id: newId(), kind, url, width: 640, height: 640 };
}

// ---------- Seed builders -------------------------------------------------------

export async function buildSeedGarments(): Promise<Garment[]> {
  const defs: Array<{ name: string; category: Garment['category']; mainColor: string; layerRole: Garment['layerRole']; warmthScore: number; thickness: Garment['thickness'] }> = [
    { name: 'White Tee', category: 'tops', layerRole: 'base', mainColor: '#f5f5f5', thickness: 'light', warmthScore: 2 },
    { name: 'White Long Sleeve', category: 'tops', layerRole: 'base', mainColor: '#f5f5f5', thickness: 'light', warmthScore: 3 },
    { name: 'Pink Shirt', category: 'tops', layerRole: 'base', mainColor: '#e9a1b1', thickness: 'light', warmthScore: 3 },
    { name: 'Blue Shirt', category: 'tops', layerRole: 'base', mainColor: '#4b83a8', thickness: 'light', warmthScore: 3 },
    { name: 'Red Tee', category: 'tops', layerRole: 'base', mainColor: '#c52b37', thickness: 'light', warmthScore: 2 },
    { name: 'Purple Tee', category: 'tops', layerRole: 'base', mainColor: '#7650a5', thickness: 'light', warmthScore: 2 },
    { name: 'Mustard Long Sleeve', category: 'tops', layerRole: 'base', mainColor: '#c28b1d', thickness: 'light', warmthScore: 3 },
    { name: 'Light Jeans', category: 'bottoms', layerRole: 'base', mainColor: '#9bb3ca', thickness: 'medium', warmthScore: 5 },
    { name: 'Grey Long Sleeve', category: 'tops', layerRole: 'base', mainColor: '#8c9198', thickness: 'light', warmthScore: 3 },
    { name: 'Green Cargo Trousers', category: 'bottoms', layerRole: 'base', mainColor: '#516b43', thickness: 'medium', warmthScore: 5 },
    { name: 'Dark Jeans', category: 'bottoms', layerRole: 'base', mainColor: '#263b51', thickness: 'medium', warmthScore: 5 },
    { name: 'Cream Hoodie', category: 'tops', layerRole: 'middle', mainColor: '#e6dfd2', thickness: 'heavy', warmthScore: 7 },
    { name: 'Cargo Trousers', category: 'bottoms', layerRole: 'base', mainColor: '#b0a88e', thickness: 'medium', warmthScore: 5 },
    { name: 'Brown Trousers', category: 'bottoms', layerRole: 'base', mainColor: '#765136', thickness: 'medium', warmthScore: 5 },
    { name: 'Blue Zip Up', category: 'outerwear', layerRole: 'outer', mainColor: '#416786', thickness: 'medium', warmthScore: 5 },
    { name: 'Black Zip Up', category: 'outerwear', layerRole: 'outer', mainColor: '#252525', thickness: 'medium', warmthScore: 5 },
    { name: 'Black Tee', category: 'tops', layerRole: 'base', mainColor: '#171717', thickness: 'light', warmthScore: 2 },
    { name: 'Black Hoodie', category: 'tops', layerRole: 'middle', mainColor: '#202020', thickness: 'heavy', warmthScore: 7 },
    { name: 'Beige Jacket', category: 'outerwear', layerRole: 'outer', mainColor: '#cab9a1', thickness: 'heavy', warmthScore: 7 }
  ];
  const out: Garment[] = [];
  for (const d of defs) {
    const image = img(d.name, CLOTHING_PHOTOS[d.name], 'display');
    out.push({
      id: newId(),
      name: d.name,
      category: d.category,
      layerRole: d.layerRole,
      mainColor: d.mainColor,
      secondaryColors: [],
      pattern: 'solid',
      texture: 'smooth',
      thickness: (d.thickness as any) ?? 'medium',
      warmthScore: d.warmthScore ?? 5,
      features: (d as any).features ?? { hood: false, waterproof: false, insulated: false, moistureWicking: false },
      careLabel: { machineWashable: true, noTumbleDry: false, handWashOnly: false, noBleach: true, dryCleanOnly: false, maxWashTempC: 40 },
      maxWearsBeforeWash: d.category === 'bottoms' ? 4 : d.category === 'outerwear' ? 8 : 2,
      wearsSinceWash: 0,
      laundryStatus: 'clean',
      laundryGroupId: null,
      lastWornAt: null,
      attributeSource: 'user',
      images: [image as any],
      isGeneratedApproximation: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  return out;
}

export function buildSeedOutfit(garments: Garment[]): Outfit | null {
  const byCat = (c: string) => garments.find((g) => g.category === c);
  const tee = byCat('tops');
  const jeans = byCat('bottoms');
  const sneakers = byCat('footwear');
  if (!tee || !jeans || !sneakers) return null;
  return {
    id: newId(),
    name: 'Campus Casual',
    layers: [
      { id: newId(), category: 'tops', garmentIds: [tee.id] },
      { id: newId(), category: 'bottoms', garmentIds: [jeans.id] },
      { id: newId(), category: 'footwear', garmentIds: [sneakers.id] }
    ],
    favorite: true,
    rating: 4,
    lastWornAt: null,
    wearCount: 0,
    metrics: { colorHarmony: 78, estimatedWarmth: 4, formality: 3 },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

export async function buildSeedFood(): Promise<FoodItem[]> {
  const defs: Array<{ name: keyof typeof FOOD_PHOTOS; days: number; qty: number; unit: string; loc: FoodItem['storageLocation']; certainty: FoodItem['dateCertainty']; nutrition: { calories: number; proteinG: number; carbsG: number; fatG: number; servingSize: string } }> = [
    { name: 'Tomato', days: 5, qty: 4, unit: 'pcs', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, servingSize: '100 g' } },
    { name: 'Spinach', days: 3, qty: 1, unit: 'bag', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, servingSize: '100 g' } },
    { name: 'Pasta', days: 300, qty: 1, unit: 'pack', loc: 'cupboard', certainty: 'best-before', nutrition: { calories: 350, proteinG: 13, carbsG: 72, fatG: 1.5, servingSize: '100 g dry' } },
    { name: 'Oats', days: 365, qty: 1, unit: 'pack', loc: 'cupboard', certainty: 'best-before', nutrition: { calories: 389, proteinG: 17, carbsG: 66, fatG: 7, servingSize: '100 g dry' } },
    { name: 'Milk', days: 3, qty: 1, unit: 'bottle', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, servingSize: '100 ml' } },
    { name: 'Heavy Cream', days: 5, qty: 1, unit: 'carton', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 340, proteinG: 2.8, carbsG: 2.8, fatG: 36, servingSize: '100 ml' } },
    { name: 'Eggs', days: 14, qty: 6, unit: 'pcs', loc: 'fridge', certainty: 'best-before', nutrition: { calories: 143, proteinG: 13, carbsG: 0.7, fatG: 9.5, servingSize: '100 g' } },
    { name: 'Chicken', days: 2, qty: 500, unit: 'g', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, servingSize: '100 g cooked' } },
    { name: 'Cheese', days: 20, qty: 1, unit: 'pack', loc: 'fridge', certainty: 'use-by', nutrition: { calories: 402, proteinG: 25, carbsG: 1.3, fatG: 33, servingSize: '100 g' } },
    { name: 'Wholewheat Bread', days: 5, qty: 1, unit: 'loaf', loc: 'cupboard', certainty: 'best-before', nutrition: { calories: 247, proteinG: 13, carbsG: 41, fatG: 4.2, servingSize: '100 g' } },
    { name: 'Flaxseeds', days: 365, qty: 1, unit: 'pack', loc: 'cupboard', certainty: 'best-before', nutrition: { calories: 534, proteinG: 18, carbsG: 29, fatG: 42, servingSize: '100 g' } }
  ];
  const out: FoodItem[] = [];
  for (const d of defs) {
    const image = img(d.name, FOOD_PHOTOS[d.name]);
    out.push({
      id: newId(),
      name: d.name,
      image: image as any,
      expirationDate: d.days === null ? null : addDays(new Date(), d.days).toISOString(),
      dateCertainty: d.certainty,
      purchaseDate: addDays(new Date(), -2).toISOString(),
      quantity: d.qty,
      unit: d.unit,
      estimatedRemainingFraction: 1,
      nutrition: d.nutrition,
      storageLocation: d.loc,
      source: 'manual',
      userCorrected: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  return out;
}

export async function buildSeedRecipes(): Promise<Recipe[]> {
  const image = img('Chicken Pasta', FOOD_PHOTOS['Chicken Pasta']);
  return [
    {
      id: newId(),
      name: 'Chicken Pasta',
      image: image as any,
      servings: 2,
      ingredients: [
        { id: newId(), name: 'Chicken', quantity: 300, unit: 'g', substitutes: [] },
        { id: newId(), name: 'Pasta', quantity: 200, unit: 'g', substitutes: [] },
        { id: newId(), name: 'Cheese', quantity: 50, unit: 'g', substitutes: [] },
        { id: newId(), name: 'Heavy Cream', quantity: 100, unit: 'ml', substitutes: [] }
      ],
      steps: [
        'Cook the pasta according to the packet instructions.',
        'Cook the chicken in a pan until fully cooked through.',
        'Add heavy cream and grated cheese, then stir until smooth.',
        'Toss the pasta through the sauce and serve.'
      ],
      prepMinutes: 25,
      lastMadeAt: null,
      recurrence: { freq: 'none', interval: 1 },
      remainingServings: 0,
      tags: ['quick', 'dinner'],
      nutrition: { calories: 620, proteinG: 42, carbsG: 64, fatG: 20, fiberG: 4, servingSize: 'per serving' },
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    {
      id: newId(), name: 'Porridge', image: img('Porridge', FOOD_PHOTOS.Porridge) as any, servings: 1,
      ingredients: [{ id: newId(), name: 'Oats', quantity: 50, unit: 'g', substitutes: [] }, { id: newId(), name: 'Milk', quantity: 200, unit: 'ml', substitutes: [] }],
      steps: ['Simmer oats and milk together, stirring until creamy.', 'Serve warm with your favourite topping.'], prepMinutes: 8,
      lastMadeAt: null, recurrence: { freq: 'none', interval: 1 }, remainingServings: 0, tags: ['breakfast', 'quick'],
      nutrition: { calories: 290, proteinG: 12, carbsG: 43, fatG: 8, fiberG: 5, servingSize: 'per bowl' }, createdAt: nowIso(), updatedAt: nowIso()
    }
  ];
}

export function buildSeedShoppingItems(): ShoppingItem[] {
  return [
    ['Tomato', 4, 'pcs'], ['Eggs', 6, 'pcs'], ['Oats', 1, 'pack'],
    ['Cheese', 1, 'pack'], ['Bread', 1, 'loaf'], ['Chicken', 500, 'g'], ['Milk', 1, 'bottle']
  ].map(([name, quantity, unit]) => ({
    id: newId(), name: String(name), quantity: Number(quantity), unit: String(unit), purchased: false,
    reason: 'manual', priceSource: 'unknown', estimatedPrice: null,
    createdAt: nowIso(), updatedAt: nowIso()
  } as ShoppingItem));
}

export function buildSeedTasks(): Task[] {
  const now = new Date();
  return [
    {
      id: newId(),
      title: 'Submit calculus problem set',
      category: 'coursework',
      dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9).toISOString(),
      priority: 'high',
      recurrence: { freq: 'none', interval: 1 },
      completed: false,
      completedAt: null,
      reminderMinutesBefore: [60],
      linkedShoppingItemIds: [],
      classificationSource: 'user',
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    {
      id: newId(),
      title: 'Check coursework portal',
      category: 'coursework',
      dueAt: addDays(now, 3).toISOString(),
      priority: 'low',
      recurrence: { freq: 'weekly', interval: 1 },
      completed: false,
      completedAt: null,
      reminderMinutesBefore: [],
      linkedShoppingItemIds: [],
      classificationSource: 'user',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];
}

export function buildSeedEvents(): CalendarEvent[] {
  return [];
}

