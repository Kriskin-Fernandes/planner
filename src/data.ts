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
import { saveImageBlob } from './db';
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

export async function generatePlaceholderImageBlob(label: string, color: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 400, 400);
  // subtle gradient overlay
  const grad = ctx.createLinearGradient(0, 0, 400, 400);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  ctx.fillText(initial, 200, 210);
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('DEMO', 200, 370);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png', 0.9));
}

async function img(label: string, color: string, kind: 'original' | 'display' = 'display') {
  const clothingPhotos = ['photo-1521572163474-6864f9cf17ab','photo-1551028719-00167b16eac5','photo-1542272604-787c3835535d','photo-1542291026-7eec264c27ff','photo-1523381210434-271e8be1f52b'];
  const foodPhotos = ['photo-1540420773420-3366772f4999','photo-1571771894821-ce9b6c11b08e','photo-1560806887-1e4cd0b6cbd6','photo-1518977676601-b53f82aba655','photo-1547592180-85f173990554'];
  const key = label.toLowerCase();
  const isFood = /milk|egg|spinach|chicken|peas|rice|pasta|yogurt|strawberr|avocado|carrot|cheddar|butter|tofu|salmon|blueberr|broccoli|lentil|oat|berry|stir fry/.test(key);
  const photos = isFood ? foodPhotos : clothingPhotos;
  const seed = photos[key.length % photos.length];
  const url = `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=640&q=80`;
  return { id: newId(), kind, url, width: 640, height: 640 };
}

// ---------- Seed builders -------------------------------------------------------

export async function buildSeedGarments(): Promise<Garment[]> {
  const defs: Array<Partial<Garment> & { name: string; category: Garment['category']; mainColor: string; layerRole: Garment['layerRole'] }> = [
    { name: 'White Crew Tee', category: 'tops', layerRole: 'base', mainColor: '#f5f5f5', thickness: 'light', warmthScore: 2 },
    { name: 'Navy Hoodie', category: 'tops', layerRole: 'middle', mainColor: '#1e3a5f', thickness: 'heavy', warmthScore: 7, features: { hood: true, waterproof: false, insulated: true, moistureWicking: false } as any },
    { name: 'Blue Jeans', category: 'bottoms', layerRole: 'base', mainColor: '#3b5a7a', thickness: 'medium', warmthScore: 5 },
    { name: 'Black Joggers', category: 'bottoms', layerRole: 'base', mainColor: '#222222', thickness: 'medium', warmthScore: 5 },
    { name: 'White Sneakers', category: 'footwear', layerRole: 'flexible', mainColor: '#fafafa', thickness: 'light', warmthScore: 3 },
    { name: 'Rain Jacket', category: 'outerwear', layerRole: 'outer', mainColor: '#2c6e49', thickness: 'medium', warmthScore: 5, features: { hood: true, waterproof: true, insulated: false, moistureWicking: false } as any },
    { name: 'Grey Beanie', category: 'headwear', layerRole: 'flexible', mainColor: '#6b7280', thickness: 'medium', warmthScore: 6 },
    { name: 'Canvas Tote', category: 'accessories', layerRole: 'flexible', mainColor: '#d6c7a1', thickness: 'light', warmthScore: 0 },
    { name: 'Striped Oxford Shirt', category: 'tops', layerRole: 'base', mainColor: '#dbeafe', thickness: 'light', warmthScore: 3 },
    { name: 'Black Turtleneck', category: 'tops', layerRole: 'base', mainColor: '#171717', thickness: 'medium', warmthScore: 5 },
    { name: 'Cream Knit Sweater', category: 'tops', layerRole: 'middle', mainColor: '#e7e5e4', thickness: 'heavy', warmthScore: 7 },
    { name: 'Green Polo Shirt', category: 'tops', layerRole: 'base', mainColor: '#166534', thickness: 'light', warmthScore: 3 },
    { name: 'Black Chinos', category: 'bottoms', layerRole: 'base', mainColor: '#292524', thickness: 'medium', warmthScore: 4 },
    { name: 'Beige Wide-Leg Trousers', category: 'bottoms', layerRole: 'base', mainColor: '#d6c7a1', thickness: 'medium', warmthScore: 4 },
    { name: 'Denim Shorts', category: 'bottoms', layerRole: 'base', mainColor: '#5b7894', thickness: 'light', warmthScore: 2 },
    { name: 'Black Leggings', category: 'bottoms', layerRole: 'base', mainColor: '#18181b', thickness: 'light', warmthScore: 3 },
    { name: 'Brown Chelsea Boots', category: 'footwear', layerRole: 'flexible', mainColor: '#78350f', thickness: 'heavy', warmthScore: 5 },
    { name: 'Running Trainers', category: 'footwear', layerRole: 'flexible', mainColor: '#e5e7eb', thickness: 'light', warmthScore: 3 },
    { name: 'Denim Jacket', category: 'outerwear', layerRole: 'outer', mainColor: '#35536e', thickness: 'medium', warmthScore: 5 },
    { name: 'Wool Coat', category: 'outerwear', layerRole: 'outer', mainColor: '#44403c', thickness: 'heavy', warmthScore: 8 },
    { name: 'Baseball Cap', category: 'headwear', layerRole: 'flexible', mainColor: '#1e3a5f', thickness: 'light', warmthScore: 1 },
    { name: 'Leather Belt', category: 'accessories', layerRole: 'flexible', mainColor: '#78350f', thickness: 'light', warmthScore: 0 },
    { name: 'Grey Scarf', category: 'accessories', layerRole: 'flexible', mainColor: '#9ca3af', thickness: 'heavy', warmthScore: 4 }
  ];
  const out: Garment[] = [];
  for (const d of defs) {
    const image = await img(d.name, d.mainColor, 'display');
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
  const defs: Array<{ name: string; color: string; days: number | null; qty: number; unit: string; loc: FoodItem['storageLocation']; certainty: FoodItem['dateCertainty'] }> = [
    { name: 'Milk', color: '#eef2ff', days: 3, qty: 1, unit: 'L', loc: 'fridge', certainty: 'use-by' },
    { name: 'Eggs', color: '#fde68a', days: 14, qty: 6, unit: 'pcs', loc: 'fridge', certainty: 'best-before' },
    { name: 'Spinach', color: '#166534', days: 2, qty: 1, unit: 'bag', loc: 'fridge', certainty: 'use-by' },
    { name: 'Chicken Breast', color: '#fecaca', days: 1, qty: 500, unit: 'g', loc: 'fridge', certainty: 'use-by' },
    { name: 'Frozen Peas', color: '#86efac', days: 180, qty: 1, unit: 'bag', loc: 'freezer', certainty: 'best-before' },
    { name: 'Rice', color: '#f5f5f4', days: 365, qty: 2, unit: 'kg', loc: 'cupboard', certainty: 'best-before' },
    { name: 'Pasta', color: '#fde047', days: 300, qty: 1, unit: 'kg', loc: 'cupboard', certainty: 'best-before' },
    { name: 'Greek Yogurt', color: '#e0f2fe', days: -1, qty: 1, unit: 'tub', loc: 'fridge', certainty: 'use-by' },
    { name: 'Strawberries', color: '#ef4444', days: 3, qty: 1, unit: 'punnet', loc: 'fridge', certainty: 'use-by' },
    { name: 'Avocados', color: '#65a30d', days: 4, qty: 2, unit: 'pcs', loc: 'fridge', certainty: 'best-before' },
    { name: 'Carrots', color: '#f97316', days: 14, qty: 1, unit: 'bag', loc: 'fridge', certainty: 'best-before' },
    { name: 'Cheddar Cheese', color: '#facc15', days: 20, qty: 1, unit: 'block', loc: 'fridge', certainty: 'use-by' },
    { name: 'Butter', color: '#fef3c7', days: 30, qty: 1, unit: 'pack', loc: 'fridge', certainty: 'best-before' },
    { name: 'Tofu', color: '#f5f5f4', days: 5, qty: 1, unit: 'block', loc: 'fridge', certainty: 'use-by' },
    { name: 'Salmon Fillet', color: '#fb7185', days: 1, qty: 2, unit: 'pcs', loc: 'fridge', certainty: 'use-by' },
    { name: 'Blueberries', color: '#6366f1', days: 4, qty: 1, unit: 'punnet', loc: 'fridge', certainty: 'use-by' },
    { name: 'Broccoli', color: '#15803d', days: 5, qty: 1, unit: 'head', loc: 'fridge', certainty: 'best-before' },
    { name: 'Lentils', color: '#a16207', days: 365, qty: 1, unit: 'bag', loc: 'cupboard', certainty: 'best-before' },
    { name: 'Oats', color: '#d6d3d1', days: 365, qty: 1, unit: 'bag', loc: 'cupboard', certainty: 'best-before' },
    { name: 'Frozen Berries', color: '#a5b4fc', days: 180, qty: 1, unit: 'bag', loc: 'freezer', certainty: 'best-before' }
  ];
  const out: FoodItem[] = [];
  for (const d of defs) {
    const image = await img(d.name, d.color);
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
  const image = await img('Stir Fry', '#f97316');
  return [
    {
      id: newId(),
      name: 'Chicken Spinach Stir Fry',
      image: image as any,
      servings: 2,
      ingredients: [
        { id: newId(), name: 'Chicken Breast', quantity: 300, unit: 'g', substitutes: ['Tofu'] },
        { id: newId(), name: 'Spinach', quantity: 1, unit: 'bag', substitutes: ['Kale'] },
        { id: newId(), name: 'Rice', quantity: 200, unit: 'g', substitutes: ['Pasta'] },
        { id: newId(), name: 'Soy Sauce', quantity: 2, unit: 'tbsp', substitutes: [] }
      ],
      steps: [
        'Cook rice according to package instructions.',
        'Slice chicken and stir-fry until golden.',
        'Add spinach and soy sauce, cook until wilted.',
        'Serve chicken and spinach over rice.'
      ],
      prepMinutes: 25,
      lastMadeAt: null,
      recurrence: { freq: 'none', interval: 1 },
      remainingServings: 0,
      tags: ['quick', 'dinner'],
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];
}

export function buildSeedShoppingItems(): ShoppingItem[] {
  return [
    ['Bananas', 6, 'pcs', 1.20], ['Wholemeal bread', 1, 'loaf', 1.45], ['Oat milk', 2, 'cartons', 3.00],
    ['Pasta', 2, 'packs', 2.00], ['Tomatoes', 6, 'pcs', 1.80], ['Chickpeas', 3, 'cans', 2.10],
    ['Spinach', 1, 'bag', 1.50], ['Greek yogurt', 1, 'tub', 2.20], ['Cheddar', 1, 'block', 3.25],
    ['Apples', 6, 'pcs', 2.40], ['Rice', 1, 'bag', 2.00], ['Eggs', 12, 'pcs', 3.10]
  ].map(([name, quantity, unit, price], index) => ({
    id: newId(), name: String(name), quantity: Number(quantity), unit: String(unit), purchased: false,
    reason: index < 2 ? 'manual' : 'recipe', priceSource: 'estimated', estimatedPrice: Number(price),
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
      dueAt: addDays(now, 1).toISOString(),
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
      title: 'Buy groceries for the week',
      category: 'errand',
      dueAt: addDays(now, 2).toISOString(),
      location: 'Campus Supermarket',
      priority: 'medium',
      recurrence: { freq: 'weekly', interval: 1 },
      completed: false,
      completedAt: null,
      reminderMinutesBefore: [120],
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
  const now = new Date();
  const classStart = addHours(now, 20);
  return [
    {
      id: newId(),
      title: 'Linear Algebra Lecture',
      location: 'Maths Building, Room 204',
      start: classStart.toISOString(),
      end: addHours(classStart, 1).toISOString(),
      allDay: false,
      recurrence: { freq: 'weekly', interval: 1 },
      category: 'class',
      reminderMinutesBefore: [15],
      externalSource: 'local',
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    {
      id: newId(),
      title: 'Study Group',
      location: 'Library',
      start: addDays(now, 1).toISOString(),
      end: addHours(addDays(now, 1), 2).toISOString(),
      allDay: false,
      recurrence: { freq: 'none', interval: 1 },
      category: 'personal',
      reminderMinutesBefore: [30],
      externalSource: 'local',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
  ];
}

