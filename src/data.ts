// ---------------------------------------------------------------------------
// UI constants and demo/seed data. All seeded images are generated locally
// (coloured placeholder cards) -- they are clearly not real photographs and
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

// ---------- Placeholder image generation (local, no AI, no network) -----------

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
  const blob = await generatePlaceholderImageBlob(label, color);
  const blobKey = `seed-${newId()}`;
  await saveImageBlob(blobKey, blob);
  return { id: newId(), blobKey, kind, width: 400, height: 400 };
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
    { name: 'Canvas Tote', category: 'accessories', layerRole: 'flexible', mainColor: '#d6c7a1', thickness: 'light', warmthScore: 0 }
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
    { name: 'Greek Yogurt', color: '#e0f2fe', days: -1, qty: 1, unit: 'tub', loc: 'fridge', certainty: 'use-by' }
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
    { id: newId(), name: 'Bananas', quantity: 6, unit: 'pcs', purchased: false, reason: 'manual', priceSource: 'unknown', createdAt: nowIso(), updatedAt: nowIso() },
    { id: newId(), name: 'Bread', quantity: 1, unit: 'loaf', purchased: false, reason: 'low-stock', priceSource: 'unknown', createdAt: nowIso(), updatedAt: nowIso() }
  ];
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
