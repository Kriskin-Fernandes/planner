// ---------------------------------------------------------------------------
// Shared application state layer (React Context). UI components call the
// functions exposed here instead of touching IndexedDB or services directly.
// This is where cross-feature propagation rules from the spec are enforced
// (e.g. marking an outfit worn updates garment wear/laundry state).
// ---------------------------------------------------------------------------
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  newId,
  nowIso,
  UserPreferencesSchema,
  ApplicationSettingsSchema,
  ExportBundleSchema,
  type Garment,
  type Outfit,
  type OutfitFeedback,
  type LaundryGroup,
  type WashRecord,
  type FoodItem,
  type Recipe,
  type MealPlan,
  type ShoppingItem,
  type CalendarEvent,
  type Task,
  type Reminder,
  type UserPreferences,
  type ApplicationSettings,
  type ExportBundle
} from './types';
import * as db from './db';
import {
  garmentsStore,
  outfitsStore,
  outfitFeedbackStore,
  laundryGroupsStore,
  washRecordsStore,
  foodItemsStore,
  recipesStore,
  mealPlansStore,
  shoppingItemsStore,
  calendarEventsStore,
  tasksStore,
  remindersStore,
  kvGet,
  kvSet,
  saveImageBlob,
  getImageBlob
} from './db';
import { applyWearToGarments, completeWash as completeWashTransform, consumeIngredients, reconcileShoppingList, icsToEvents } from './services';
import { DEFAULT_LAUNDRY_GROUP_DEFS, buildSeedGarments, buildSeedOutfit, buildStarterOutfits, buildSeedFood, buildSeedRecipes, buildSeedShoppingItems, buildSeedTasks, buildSeedEvents } from './data';
import { loadPersistedApiKeyIfAny } from './ai';

function autoFileNeedsWash(garments: Garment[], groups: LaundryGroup[]) {
  const nextGarments = garments.map((garment) => ({ ...garment }));
  const nextGroups = groups.map((group) => ({ ...group, garmentIds: [...group.garmentIds] }));
  let changed = false;
  for (const garment of nextGarments) {
    if (garment.wearsSinceWash < garment.maxWearsBeforeWash || garment.laundryGroupId) continue;
    const color = garment.mainColor.match(/^#([\da-f]{6})$/i)?.[1];
    const rgb = color ? [0, 2, 4].map((offset) => parseInt(color.slice(offset, offset + 2), 16)) : [128, 128, 128];
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    const preferredName = garment.careLabel.dryCleanOnly || garment.careLabel.handWashOnly || (garment.careLabel.maxWashTempC ?? 40) <= 30
      ? 'delicates'
      : /denim|jean/i.test(garment.name) ? 'denim' : brightness < 112 ? 'darks' : 'lights';
    const group = nextGroups.find((candidate) => candidate.name.toLowerCase().includes(preferredName))
      ?? nextGroups.find((candidate) => candidate.isDefault)
      ?? nextGroups[0];
    if (!group) {
      garment.laundryStatus = 'needs-wash';
      changed = true;
      continue;
    }
    group.garmentIds = Array.from(new Set([...group.garmentIds, garment.id]));
    garment.laundryGroupId = group.id;
    garment.laundryStatus = 'needs-wash';
    garment.updatedAt = nowIso();
    group.updatedAt = nowIso();
    changed = true;
  }
  return { garments: nextGarments, groups: nextGroups, changed };
}

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface AppState {
  loading: boolean;
  garments: Garment[];
  outfits: Outfit[];
  outfitFeedback: OutfitFeedback[];
  laundryGroups: LaundryGroup[];
  washRecords: WashRecord[];
  foodItems: FoodItem[];
  recipes: Recipe[];
  mealPlans: MealPlan[];
  shoppingItems: ShoppingItem[];
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  reminders: Reminder[];
  preferences: UserPreferences;
  settings: ApplicationSettings;
  toasts: Toast[];
}

interface AppApi extends AppState {
  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;

  addGarment: (g: Garment) => Promise<void>;
  updateGarment: (id: string, patch: Partial<Garment>) => Promise<void>;
  deleteGarment: (id: string) => Promise<void>;

  addOutfit: (o: Outfit) => Promise<void>;
  updateOutfit: (id: string, patch: Partial<Outfit>) => Promise<void>;
  deleteOutfit: (id: string) => Promise<void>;
  markOutfitWorn: (id: string) => Promise<void>;
  addOutfitFeedback: (fb: OutfitFeedback) => Promise<void>;

  addLaundryGroup: (g: LaundryGroup) => Promise<void>;
  updateLaundryGroup: (id: string, patch: Partial<LaundryGroup>) => Promise<void>;
  deleteLaundryGroup: (id: string) => Promise<void>;
  assignGarmentToGroup: (garmentId: string, groupId: string | null) => Promise<void>;
  completeWash: (groupId: string) => Promise<void>;

  addFoodItem: (f: FoodItem) => Promise<void>;
  updateFoodItem: (id: string, patch: Partial<FoodItem>) => Promise<void>;
  deleteFoodItem: (id: string) => Promise<void>;

  addRecipe: (r: Recipe) => Promise<void>;
  updateRecipe: (id: string, patch: Partial<Recipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  prepareMeal: (recipeId: string, servingsMade: number) => Promise<void>;

  addMealPlan: (m: MealPlan) => Promise<void>;
  updateMealPlan: (id: string, patch: Partial<MealPlan>) => Promise<void>;
  deleteMealPlan: (id: string) => Promise<void>;

  addShoppingItem: (s: ShoppingItem) => Promise<void>;
  updateShoppingItem: (id: string, patch: Partial<ShoppingItem>) => Promise<void>;
  deleteShoppingItem: (id: string) => Promise<void>;
  addFoodFromShoppingItem: (shoppingItemId: string) => Promise<void>;
  runShoppingReconciliation: (recipeIds: string[]) => Promise<void>;

  addCalendarEvent: (e: CalendarEvent) => Promise<void>;
  updateCalendarEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<void>;
  deleteCalendarEvent: (id: string) => Promise<void>;
  importEvents: (events: CalendarEvent[]) => Promise<void>;

  addTask: (t: Task) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTaskComplete: (id: string) => Promise<void>;

  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  updateSettings: (patch: Partial<ApplicationSettings>) => Promise<void>;

  exportData: () => Promise<Blob>;
  importData: (file: File) => Promise<{ ok: boolean; message: string }>;
  resetAllData: () => Promise<void>;

  saveImage: (blob: Blob, kind: 'original' | 'display' | 'cutout' | 'thumbnail') => Promise<{ id: string; blobKey: string; kind: string }>;
}

const AppContext = createContext<AppApi | null>(null);

const SEED_FLAG_KEY = 'seeded-v1';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    loading: true,
    garments: [],
    outfits: [],
    outfitFeedback: [],
    laundryGroups: [],
    washRecords: [],
    foodItems: [],
    recipes: [],
    mealPlans: [],
    shoppingItems: [],
    calendarEvents: [],
    tasks: [],
    reminders: [],
    preferences: UserPreferencesSchema.parse({}),
    settings: ApplicationSettingsSchema.parse({}),
    toasts: []
  });

  const firedRemindersRef = useRef<Set<string>>(new Set());

  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = newId();
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }, []);

  // ---------- Initial load + seeding -----------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      loadPersistedApiKeyIfAny();
      const seeded = await kvGet<boolean>(SEED_FLAG_KEY);
      if (!seeded) {
        try {
          const garments = await buildSeedGarments();
          await garmentsStore.putMany(garments);
          const outfit = buildSeedOutfit(garments);
          if (outfit) await outfitsStore.put(outfit);
          const groups: LaundryGroup[] = DEFAULT_LAUNDRY_GROUP_DEFS.map((d) => ({
            id: newId(),
            name: d.name,
            isDefault: true,
            garmentIds: [],
            washTempC: d.washTempC,
            cycle: d.cycle,
            spin: d.spin,
            dryingRecommendation: d.dryingRecommendation,
            userCorrected: false,
            createdAt: nowIso(),
            updatedAt: nowIso()
          }));
          await laundryGroupsStore.putMany(groups);
          const food = await buildSeedFood();
          await foodItemsStore.putMany(food);
          const recipes = await buildSeedRecipes();
          await recipesStore.putMany(recipes);
          await shoppingItemsStore.putMany(buildSeedShoppingItems());
          await tasksStore.putMany(buildSeedTasks());
          await calendarEventsStore.putMany(buildSeedEvents());
          await kvSet(SEED_FLAG_KEY, true);
        } catch (err) {
          console.error('Seeding failed', err);
        }
      }

      if (!(await kvGet<boolean>('calendar-defaults-removed'))) {
        const seededDefaultTitles = new Set(['Linear Algebra Lecture', 'Study Group']);
        for (const event of await calendarEventsStore.all()) {
          if (seededDefaultTitles.has(event.title) && event.externalSource === 'local') await calendarEventsStore.remove(event.id);
        }
        await kvSet('calendar-defaults-removed', true);
      }

      // Bring the supplied timetable into a fresh browser profile once.
      if (!(await kvGet<boolean>('calendar-file-imported-v1'))) {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}calendar.ics`);
          if (response.ok) {
            const imported = icsToEvents(await response.text()).map((event) => ({ ...event, location: undefined, locationTag: 'Uni' }));
            const present = new Set((await calendarEventsStore.all()).map((event) => `${event.title}|${event.start}`));
            const additions = imported.filter((event) => !present.has(`${event.title}|${event.start}`));
            if (additions.length) await calendarEventsStore.putMany(additions);
          }
        } catch (error) { console.warn('Calendar import could not be loaded', error); }
        await kvSet('calendar-file-imported-v1', true);
      }

      // Add the requested errands and daily reminder once, including on existing installs.
      if (!(await kvGet<boolean>('requested-tasks-v1'))) {
        const existing = new Set((await tasksStore.all()).map((task) => task.title.toLowerCase()));
        const now = new Date();
        const makeTask = (title: string, location: string | undefined, recurrence: Task['recurrence'] = { freq: 'none', interval: 1 }): Task => ({
          id: newId(), title, category: 'errand', dueAt: now.toISOString(), location, priority: 'medium', recurrence,
          completed: false, completedAt: null, reminderMinutesBefore: [], linkedShoppingItemIds: [], classificationSource: 'user', createdAt: nowIso(), updatedAt: nowIso()
        });
        const requested = [
          makeTask('Get medicine from Hammersmith Pharmacy', 'Hammersmith Pharmacy'),
          makeTask('Get student ID from Imperial campus', undefined, { freq: 'none', interval: 1 }),
          makeTask('Take vitamins', undefined, { freq: 'daily', interval: 1 })
        ].filter((task) => !existing.has(task.title.toLowerCase()));
        for (const task of requested) if (task.title.toLowerCase().includes('student id')) task.locationTag = 'Uni';
        if (requested.length) await tasksStore.putMany(requested);
        await kvSet('requested-tasks-v1', true);
      }

      // Update the saved address and move the existing medicine errand to the
      // Cromwell Hospital location on existing browser profiles as well.
      if (!(await kvGet<boolean>('cromwell-home-errand-v1'))) {
        const savedSettings = await kvGet<ApplicationSettings>('settings');
        if (savedSettings) {
          await kvSet('settings', ApplicationSettingsSchema.parse({
            ...savedSettings,
            homeAddress: '42 Redfield Lane, London, SW5 0RQ'
          }));
        }
        for (const task of await tasksStore.all()) {
          const medicineErrand = /medicine/i.test(task.title) && (/hammersmith pharmacy/i.test(task.title) || /hammersmith pharmacy/i.test(task.location ?? ''));
          if (medicineErrand) {
            await tasksStore.put({ ...task, title: 'Get medicine from Cromwell Hospital', location: 'Cromwell Hospital', updatedAt: nowIso() });
          }
        }
        await kvSet('cromwell-home-errand-v1', true);
      }

      if (!(await kvGet<boolean>('today-agenda-tasks-v1'))) {
        const today = new Date();
        today.setHours(9, 0, 0, 0);
        for (const task of await tasksStore.all()) {
          if (/^buy groceries for the week$/i.test(task.title.trim()) || /^get groceries from campus supermarket$/i.test(task.title.trim())) await tasksStore.remove(task.id);
          else if (/^submit calculus problem set$/i.test(task.title.trim()) && !task.completed) await tasksStore.put({ ...task, dueAt: today.toISOString(), updatedAt: nowIso() });
        }
        await kvSet('today-agenda-tasks-v1', true);
      }

      const todayDate = new Date();
      for (const task of await tasksStore.all()) {
        if (task.recurrence.freq !== 'daily' || !task.dueAt || new Date(task.dueAt).toDateString() === todayDate.toDateString()) continue;
        await tasksStore.put({ ...task, dueAt: todayDate.toISOString(), completed: false, completedAt: null, updatedAt: nowIso() });
      }

      // Replace only the old dish-as-ingredient entries with the proper meal records.
      if (!(await kvGet<boolean>('meal-catalog-v2'))) {
        for (const item of await shoppingItemsStore.all()) if (/^(porridge|chicken pasta)$/i.test(item.name.trim())) await shoppingItemsStore.remove(item.id);
        for (const item of await foodItemsStore.all()) if (/^(porridge|chicken pasta)$/i.test(item.name.trim())) await foodItemsStore.remove(item.id);
        if (!(await recipesStore.all()).some((recipe) => recipe.name === 'Porridge')) await recipesStore.putMany((await buildSeedRecipes()).filter((recipe) => recipe.name === 'Porridge'));
        await kvSet('meal-catalog-v2', true);
      }

      if (!(await kvGet<boolean>('nutrition-estimates-v1'))) {
        const ingredientNutrition: Record<string, NonNullable<FoodItem['nutrition']>> = {
          tomato: { calories: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, servingSize: '100 g' }, spinach: { calories: 23, proteinG: 2.9, carbsG: 3.6, fatG: 0.4, servingSize: '100 g' },
          pasta: { calories: 350, proteinG: 13, carbsG: 72, fatG: 1.5, servingSize: '100 g dry' }, oats: { calories: 389, proteinG: 17, carbsG: 66, fatG: 7, servingSize: '100 g dry' },
          milk: { calories: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3, servingSize: '100 ml' }, 'heavy cream': { calories: 340, proteinG: 2.8, carbsG: 2.8, fatG: 36, servingSize: '100 ml' },
          eggs: { calories: 143, proteinG: 13, carbsG: 0.7, fatG: 9.5, servingSize: '100 g' }, chicken: { calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6, servingSize: '100 g cooked' },
          cheese: { calories: 402, proteinG: 25, carbsG: 1.3, fatG: 33, servingSize: '100 g' }, bread: { calories: 247, proteinG: 13, carbsG: 41, fatG: 4.2, servingSize: '100 g' }, flaxseeds: { calories: 534, proteinG: 18, carbsG: 29, fatG: 42, servingSize: '100 g' }
        };
        for (const food of await foodItemsStore.all()) if (!food.nutrition && ingredientNutrition[food.name.toLowerCase()]) await foodItemsStore.put({ ...food, nutrition: ingredientNutrition[food.name.toLowerCase()] });
        const recipeNutrition: Record<string, NonNullable<Recipe['nutrition']>> = {
          'chicken pasta': { calories: 620, proteinG: 42, carbsG: 64, fatG: 20, fiberG: 4, servingSize: 'per serving' },
          porridge: { calories: 290, proteinG: 12, carbsG: 43, fatG: 8, fiberG: 5, servingSize: 'per bowl' }
        };
        for (const recipe of await recipesStore.all()) if (!recipe.nutrition && recipeNutrition[recipe.name.toLowerCase()]) await recipesStore.put({ ...recipe, nutrition: recipeNutrition[recipe.name.toLowerCase()] });
        await kvSet('nutrition-estimates-v1', true);
      }

      // Grow older installs' original small demo catalogue without disturbing
      // anything the user has edited or added.
      if (!(await kvGet<boolean>('catalog-v2-added'))) {
        const existingGarments = await garmentsStore.all();
        if (existingGarments.length > 0 && existingGarments.length < 20) {
          const names = new Set(existingGarments.map((g) => g.name));
          const additions = (await buildSeedGarments()).filter((g) => !names.has(g.name));
          if (additions.length) await garmentsStore.putMany(additions);
        }
        const existingFood = await foodItemsStore.all();
        if (existingFood.length > 0 && existingFood.length < 20) {
          const names = new Set(existingFood.map((f) => f.name));
          const additions = (await buildSeedFood()).filter((f) => !names.has(f.name));
          if (additions.length) await foodItemsStore.putMany(additions);
        }
        const existingShopping = await shoppingItemsStore.all();
        if (existingShopping.length > 0 && existingShopping.length < 10) {
          const names = new Set(existingShopping.map((item) => item.name));
          const additions = buildSeedShoppingItems().filter((item) => !names.has(item.name));
          if (additions.length) await shoppingItemsStore.putMany(additions);
        }
        await kvSet('catalog-v2-added', true);
      }

      if (!(await kvGet<boolean>('photo-catalog-v2-replaced'))) {
        const legacyImage = (image?: { blobKey?: string; url?: string }) => !!image && (image.blobKey?.startsWith('seed-') === true || image.url?.includes('images.unsplash.com') === true);
        const oldGarments = (await garmentsStore.all()).filter((g) => legacyImage(g.images[0]));
        const oldGarmentIds = new Set(oldGarments.map((g) => g.id));
        const allOutfits = await outfitsStore.all();
        const demoOutfitIds = new Set(allOutfits.filter((o) => o.name === 'Campus Casual' && o.layers.some((layer) => layer.garmentIds.some((id) => oldGarmentIds.has(id)))).map((o) => o.id));
        for (const outfitId of demoOutfitIds) await outfitsStore.remove(outfitId);
        const customOutfitGarmentIds = new Set(allOutfits.filter((o) => !demoOutfitIds.has(o.id)).flatMap((o) => o.layers.flatMap((layer) => layer.garmentIds)));
        for (const garment of oldGarments) if (!customOutfitGarmentIds.has(garment.id)) await garmentsStore.remove(garment.id);
        const existingGarments = await garmentsStore.all();
        const garmentNames = new Set(existingGarments.map((g) => g.name));
        const photoGarments = (await buildSeedGarments()).filter((g) => !garmentNames.has(g.name));
        if (photoGarments.length) await garmentsStore.putMany(photoGarments);
        const allGarments = await garmentsStore.all();
        const waterproofNames = new Set(['Blue Zip Up', 'Black Zip Up']);
        for (const garment of allGarments) if (waterproofNames.has(garment.name) && !garment.features.waterproof) {
          await garmentsStore.put({ ...garment, features: { ...garment.features, waterproof: true }, updatedAt: new Date().toISOString() });
        }
        const existingOutfits = await outfitsStore.all();
        const outfitNames = new Set(existingOutfits.map((outfit) => outfit.name));
        const starterOutfits = buildStarterOutfits(allGarments).filter((outfit) => !outfitNames.has(outfit.name));
        if (starterOutfits.length) await outfitsStore.putMany(starterOutfits);
        if (!existingOutfits.length) {
          const starterOutfit = buildSeedOutfit(allGarments);
          if (starterOutfit && !starterOutfits.some((outfit) => outfit.name === starterOutfit.name)) await outfitsStore.put(starterOutfit);
        }

        const oldRecipes = (await recipesStore.all()).filter((r) => legacyImage(r.image));
        for (const recipe of oldRecipes) await recipesStore.remove(recipe.id);
        const remainingRecipeIngredients = new Set((await recipesStore.all()).flatMap((r) => r.ingredients.map((i) => i.name.toLowerCase().trim())));
        const existingFood = await foodItemsStore.all();
        for (const food of existingFood) if (legacyImage(food.image) && !remainingRecipeIngredients.has(food.name.toLowerCase().trim())) await foodItemsStore.remove(food.id);
        const foodNames = new Set((await foodItemsStore.all()).map((f) => f.name));
        const photoFoods = (await buildSeedFood()).filter((f) => !foodNames.has(f.name));
        if (photoFoods.length) await foodItemsStore.putMany(photoFoods);
        const existingRecipes = await recipesStore.all();
        const recipeNames = new Set(existingRecipes.map((recipe) => recipe.name));
        const recipeAdditions = (await buildSeedRecipes()).filter((recipe) => !recipeNames.has(recipe.name));
        if (recipeAdditions.length) await recipesStore.putMany(recipeAdditions);

        const oldRecipeShoppingNames = new Set(['Wholemeal bread', 'Oat milk', 'Pasta', 'Tomatoes', 'Chickpeas', 'Spinach', 'Greek yogurt', 'Cheddar', 'Apples', 'Rice', 'Eggs']);
        for (const item of await shoppingItemsStore.all()) {
          const oldGeneratedRecipeItem = item.reason === 'recipe' && item.priceSource === 'estimated' && oldRecipeShoppingNames.has(item.name);
          const oldBananasDemo = item.name === 'Bananas' && item.reason === 'manual' && (item.priceSource === 'estimated' || item.priceSource === 'unknown');
          if (oldGeneratedRecipeItem || oldBananasDemo) await shoppingItemsStore.remove(item.id);
        }
        const shoppingNames = new Set((await shoppingItemsStore.all()).map((i) => i.name));
        const photoShopItems = buildSeedShoppingItems().filter((i) => !shoppingNames.has(i.name));
        if (photoShopItems.length) await shoppingItemsStore.putMany(photoShopItems);
        await kvSet('photo-catalog-v2-replaced', true);
      }

      if (!(await kvGet<boolean>('starter-outfits-waterproof-v1'))) {
        const wardrobe = await garmentsStore.all();
        for (const garment of wardrobe) if (['Blue Zip Up', 'Black Zip Up'].includes(garment.name) && !garment.features.waterproof) {
          await garmentsStore.put({ ...garment, features: { ...garment.features, waterproof: true }, updatedAt: new Date().toISOString() });
        }
        const savedOutfits = await outfitsStore.all();
        const savedNames = new Set(savedOutfits.map((outfit) => outfit.name));
        const starters = buildStarterOutfits(wardrobe).filter((outfit) => !savedNames.has(outfit.name));
        if (starters.length) await outfitsStore.putMany(starters);
        await kvSet('starter-outfits-waterproof-v1', true);
      }

      // Set the requested pantry stock and keep the starter shopping list to
      // only the seven items the user wants to demonstrate.
      if (!(await kvGet<boolean>('shopping-stock-list-v2'))) {
        const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const stockTargets = [
          { name: 'Spinach', aliases: new Set(['spinach']) },
          { name: 'Heavy Cream', aliases: new Set(['heavycream']) },
          { name: 'Wholewheat Bread', aliases: new Set(['bread', 'wholewheatbread', 'wholemealbread', 'wholemealloaf']) }
        ];
        const seededFoods = await buildSeedFood();
        const existingFoods = await foodItemsStore.all();
        for (const target of stockTargets) {
          const matches = existingFoods.filter((food) => target.aliases.has(normalizeName(food.name)));
          const primary = matches.find((food) => normalizeName(food.name) === normalizeName(target.name)) ?? matches[0];
          const stockItem = primary ?? seededFoods.find((food) => food.name === target.name);
          if (stockItem) {
            await foodItemsStore.put({ ...stockItem, name: target.name, quantity: Math.max(1, stockItem.quantity), estimatedRemainingFraction: 1, updatedAt: nowIso() });
            for (const duplicate of matches) if (duplicate.id !== stockItem.id) await foodItemsStore.remove(duplicate.id);
          }
        }

        const wantedItems = buildSeedShoppingItems();
        const wantedByName = new Map(wantedItems.map((item) => [normalizeName(item.name), item]));
        const matchedNames = new Set<string>();
        for (const item of await shoppingItemsStore.all()) {
          const normalized = normalizeName(item.name);
          const canonical = normalized === 'tomatoes' ? 'tomato'
            : normalized === 'cheddar' ? 'cheese'
              : normalized === 'wholewheatbread' || normalized === 'wholemealbread' ? 'bread'
                : normalized;
          const template = wantedByName.get(canonical);
          if (!template || matchedNames.has(canonical)) {
            await shoppingItemsStore.remove(item.id);
            continue;
          }
          matchedNames.add(canonical);
          await shoppingItemsStore.put({
            ...item,
            name: template.name,
            quantity: item.quantity > 0 ? item.quantity : template.quantity,
            unit: item.quantity > 0 ? item.unit : template.unit,
            purchased: false,
            reason: 'manual',
            updatedAt: nowIso()
          });
        }
        const missingItems = wantedItems.filter((item) => !matchedNames.has(normalizeName(item.name)));
        if (missingItems.length) await shoppingItemsStore.putMany(missingItems);
        await kvSet('shopping-stock-list-v2', true);
      }

      const [garments, outfits, outfitFeedback, laundryGroups, washRecords, foodItems, recipes, mealPlans, shoppingItems, calendarEvents, tasks, reminders, preferencesRaw, settingsRaw] =
        await Promise.all([
          garmentsStore.all(),
          outfitsStore.all(),
          outfitFeedbackStore.all(),
          laundryGroupsStore.all(),
          washRecordsStore.all(),
          foodItemsStore.all(),
          recipesStore.all(),
          mealPlansStore.all(),
          shoppingItemsStore.all(),
          calendarEventsStore.all(),
          tasksStore.all(),
          remindersStore.all(),
          kvGet<UserPreferences>('preferences'),
          kvGet<ApplicationSettings>('settings')
        ]);

      const washQueue = autoFileNeedsWash(garments, laundryGroups);
      if (washQueue.changed) {
        await garmentsStore.putMany(washQueue.garments.filter((g) => g.wearsSinceWash >= g.maxWearsBeforeWash));
        await laundryGroupsStore.putMany(washQueue.groups);
        garments.splice(0, garments.length, ...washQueue.garments);
        laundryGroups.splice(0, laundryGroups.length, ...washQueue.groups);
      }

      if (cancelled) return;
      const legacyGeminiModel = (model: string | undefined) => model === 'gemini-2.5-flash' ? 'gemini-3.8-flash' : model;
      const migratedSettings = settingsRaw ? {
        ...settingsRaw,
        homeAddress: settingsRaw.homeAddress === '69 Yeldham road' ? '42 Redfield Lane, London, SW5 0RQ' : settingsRaw.homeAddress,
        geminiModels: {
          ...settingsRaw.geminiModels,
          textModel: legacyGeminiModel(settingsRaw.geminiModels?.textModel) ?? 'gemini-3.8-flash',
          visionModel: legacyGeminiModel(settingsRaw.geminiModels?.visionModel) ?? 'gemini-3.8-flash'
        }
      } : undefined;
      const warmthBiasMigrated = await kvGet<boolean>('warmth-bias-plus-two-v1');
      const loadedPreferences = UserPreferencesSchema.parse(preferencesRaw ?? {});
      if (!warmthBiasMigrated) {
        loadedPreferences.warmthBias = 2;
        await kvSet('preferences', loadedPreferences);
        await kvSet('warmth-bias-plus-two-v1', true);
      }
      setState((s) => ({
        ...s,
        loading: false,
        garments,
        outfits,
        outfitFeedback,
        laundryGroups,
        washRecords,
        foodItems,
        recipes,
        mealPlans,
        shoppingItems,
        calendarEvents,
        tasks,
        reminders,
        preferences: loadedPreferences,
        settings: migratedSettings ? ApplicationSettingsSchema.parse(migratedSettings) : s.settings
      }));
      if (migratedSettings) await db.kvSet('settings', ApplicationSettingsSchema.parse(migratedSettings));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Reminder engine (in-app + Notification API while open) ---------
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const due: { id: string; title: string }[] = [];
      for (const t of state.tasks) {
        if (t.completed || !t.dueAt) continue;
        for (const mins of t.reminderMinutesBefore) {
          const fireAt = new Date(t.dueAt).getTime() - mins * 60000;
          const key = `task:${t.id}:${mins}`;
          if (fireAt <= now && fireAt > now - 60000 && !firedRemindersRef.current.has(key)) {
            firedRemindersRef.current.add(key);
            due.push({ id: key, title: `Due soon: ${t.title}` });
          }
        }
      }
      for (const e of state.calendarEvents) {
        for (const mins of e.reminderMinutesBefore) {
          const fireAt = new Date(e.start).getTime() - mins * 60000;
          const key = `event:${e.id}:${mins}`;
          if (fireAt <= now && fireAt > now - 60000 && !firedRemindersRef.current.has(key)) {
            firedRemindersRef.current.add(key);
            due.push({ id: key, title: `Upcoming: ${e.title}` });
          }
        }
      }
      due.forEach(({ title }) => {
        if (state.settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body: 'Student Daily Planner reminder' });
        } else {
          pushToast(title, 'info');
        }
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [state.tasks, state.calendarEvents, state.settings.notificationsEnabled, pushToast]);

  // ---------- Generic CRUD factory -------------------------------------------
  function makeCrud<T extends { id: string }>(
    key: keyof AppState,
    store: { put: (v: T) => Promise<void>; remove: (id: string) => Promise<void> }
  ) {
    const add = async (value: T) => {
      await store.put(value);
      setState((s) => ({ ...s, [key]: [...(s[key] as unknown as T[]), value] }));
    };
    const update = async (id: string, patch: Partial<T>) => {
      setState((s) => {
        const list = s[key] as unknown as T[];
        const idx = list.findIndex((x) => x.id === id);
        if (idx === -1) return s;
        const updated = { ...list[idx], ...patch, updatedAt: (patch as any).updatedAt ?? nowIso() } as T;
        store.put(updated);
        const next = [...list];
        next[idx] = updated;
        return { ...s, [key]: next };
      });
    };
    const remove = async (id: string) => {
      await store.remove(id);
      setState((s) => ({ ...s, [key]: (s[key] as unknown as T[]).filter((x) => x.id !== id) }));
    };
    return { add, update, remove };
  }

  const garmentCrud = makeCrud<Garment>('garments', garmentsStore);
  const outfitCrud = makeCrud<Outfit>('outfits', outfitsStore);
  const laundryGroupCrud = makeCrud<LaundryGroup>('laundryGroups', laundryGroupsStore);
  const foodCrud = makeCrud<FoodItem>('foodItems', foodItemsStore);
  const recipeCrud = makeCrud<Recipe>('recipes', recipesStore);
  const mealPlanCrud = makeCrud<MealPlan>('mealPlans', mealPlansStore);
  const shoppingCrud = makeCrud<ShoppingItem>('shoppingItems', shoppingItemsStore);
  const eventCrud = makeCrud<CalendarEvent>('calendarEvents', calendarEventsStore);
  const taskCrud = makeCrud<Task>('tasks', tasksStore);

  const updateGarment = useCallback(async (id: string, patch: Partial<Garment>) => {
    setState((s) => {
      const current = s.garments.find((garment) => garment.id === id);
      if (!current) return s;
      const merged: Garment = { ...current, ...patch, updatedAt: patch.updatedAt ?? nowIso() };
      const candidateGarments = s.garments.map((garment) => garment.id === id ? merged : garment);
      const needsWash = merged.wearsSinceWash >= merged.maxWearsBeforeWash;
      if (needsWash && !merged.laundryGroupId) merged.laundryStatus = 'needs-wash';
      const filed = autoFileNeedsWash(candidateGarments, s.laundryGroups);
      const updatedGarments = filed.garments;
      const updatedGroups = filed.groups;
      const updatedGarment = updatedGarments.find((garment) => garment.id === id)!;
      if (filed.changed) updatedGarments.filter((g) => g.wearsSinceWash >= g.maxWearsBeforeWash).forEach((g) => void garmentsStore.put(g));
      else void garmentsStore.put(updatedGarment);
      if (filed.changed) updatedGroups.forEach((group) => void laundryGroupsStore.put(group));
      return { ...s, garments: updatedGarments, laundryGroups: updatedGroups };
    });
  }, []);

  // ---------- Outfits: mark worn (propagates to garments) ---------------------
  const markOutfitWorn = useCallback(async (id: string) => {
    setState((s) => {
      const outfit = s.outfits.find((o) => o.id === id);
      if (!outfit) return s;
      const garmentIds = new Set(outfit.layers.flatMap((l) => l.garmentIds));
      const wornGarments = applyWearToGarments(s.garments, garmentIds);
      const filed = autoFileNeedsWash(wornGarments, s.laundryGroups);
      const updatedGarments = filed.garments;
      const updatedGroups = filed.groups;
      const updatedOutfit: Outfit = { ...outfit, lastWornAt: nowIso(), wearCount: outfit.wearCount + 1, updatedAt: nowIso() };
      updatedGarments.filter((g) => garmentIds.has(g.id)).forEach((g) => garmentsStore.put(g));
      if (filed.changed) updatedGarments.filter((g) => g.wearsSinceWash >= g.maxWearsBeforeWash).forEach((g) => garmentsStore.put(g));
      if (filed.changed) updatedGroups.forEach((group) => laundryGroupsStore.put(group));
      outfitsStore.put(updatedOutfit);
      return {
        ...s,
        garments: updatedGarments,
        laundryGroups: updatedGroups,
        outfits: s.outfits.map((o) => (o.id === id ? updatedOutfit : o))
      };
    });
  }, []);

  const addOutfitFeedback = useCallback(async (fb: OutfitFeedback) => {
    await outfitFeedbackStore.put(fb);
    setState((s) => ({ ...s, outfitFeedback: [...s.outfitFeedback, fb] }));
  }, []);

  // ---------- Laundry: assignment + completion --------------------------------
  const assignGarmentToGroup = useCallback(async (garmentId: string, groupId: string | null) => {
    setState((s) => {
      const garment = s.garments.find((g) => g.id === garmentId);
      if (!garment) return s;
      const updatedGarment: Garment = { ...garment, laundryGroupId: groupId, laundryStatus: groupId ? 'in-wash' : garment.laundryStatus, updatedAt: nowIso() };
      garmentsStore.put(updatedGarment);
      const groups = s.laundryGroups.map((g) => {
        if (g.id === groupId) return { ...g, garmentIds: Array.from(new Set([...g.garmentIds, garmentId])), updatedAt: nowIso() };
        if (g.garmentIds.includes(garmentId) && g.id !== groupId) return { ...g, garmentIds: g.garmentIds.filter((id) => id !== garmentId), updatedAt: nowIso() };
        return g;
      });
      groups.forEach((g) => laundryGroupsStore.put(g));
      return {
        ...s,
        garments: s.garments.map((g) => (g.id === garmentId ? updatedGarment : g)),
        laundryGroups: groups
      };
    });
  }, []);

  const completeWash = useCallback(async (groupId: string) => {
    setState((s) => {
      const group = s.laundryGroups.find((g) => g.id === groupId);
      if (!group) return s;
      const garmentIds = new Set(group.garmentIds);
      const updatedGarments = completeWashTransform(s.garments, garmentIds);
      updatedGarments.filter((g) => garmentIds.has(g.id)).forEach((g) => garmentsStore.put(g));
      const record: WashRecord = {
        id: newId(),
        laundryGroupId: groupId,
        garmentIds: Array.from(garmentIds),
        completedAt: nowIso(),
        washTempC: group.washTempC,
        cycle: group.cycle
      };
      washRecordsStore.put(record);
      const updatedGroup: LaundryGroup = { ...group, garmentIds: [], updatedAt: nowIso() };
      laundryGroupsStore.put(updatedGroup);
      return {
        ...s,
        garments: updatedGarments,
        washRecords: [...s.washRecords, record],
        laundryGroups: s.laundryGroups.map((g) => (g.id === groupId ? updatedGroup : g))
      };
    });
  }, []);

  // ---------- Meals: prepare (consumes inventory) ------------------------------
  const prepareMeal = useCallback(async (recipeId: string, servingsMade: number) => {
    setState((s) => {
      const recipe = s.recipes.find((r) => r.id === recipeId);
      if (!recipe) return s;
      const scaledIngredients = recipe.ingredients.map((ing) => ({ ...ing, quantity: (ing.quantity * servingsMade) / recipe.servings }));
      const updatedFood = consumeIngredients(s.foodItems, scaledIngredients);
      updatedFood.forEach((f) => foodItemsStore.put(f));
      const updatedRecipe: Recipe = {
        ...recipe,
        lastMadeAt: nowIso(),
        remainingServings: recipe.remainingServings + servingsMade,
        updatedAt: nowIso()
      };
      recipesStore.put(updatedRecipe);
      return {
        ...s,
        foodItems: updatedFood,
        recipes: s.recipes.map((r) => (r.id === recipeId ? updatedRecipe : r))
      };
    });
  }, []);

  // ---------- Shopping: add food from purchased item, reconciliation ---------
  const addFoodFromShoppingItem = useCallback(async (shoppingItemId: string) => {
    setState((s) => {
      const item = s.shoppingItems.find((i) => i.id === shoppingItemId);
      if (!item) return s;
      const food: FoodItem = {
        id: newId(),
        name: item.name,
        expirationDate: null,
        dateCertainty: 'unknown',
        purchaseDate: nowIso(),
        quantity: item.quantity,
        unit: item.unit,
        estimatedRemainingFraction: 1,
        storageLocation: 'cupboard',
        source: 'manual',
        userCorrected: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      foodItemsStore.put(food);
      return { ...s, foodItems: [...s.foodItems, food] };
    });
  }, []);

  const runShoppingReconciliation = useCallback(async (recipeIds: string[]) => {
    setState((s) => {
      const next = reconcileShoppingList(s.recipes, recipeIds, s.foodItems, s.shoppingItems);
      next.forEach((i) => shoppingItemsStore.put(i));
      return { ...s, shoppingItems: next };
    });
  }, []);

  // ---------- Calendar import ---------------------------------------------------
  const importEvents = useCallback(async (events: CalendarEvent[]) => {
    await calendarEventsStore.putMany(events);
    setState((s) => ({ ...s, calendarEvents: [...s.calendarEvents, ...events] }));
  }, []);

  // ---------- Task toggle ---------------------------------------------------------
  const toggleTaskComplete = useCallback(async (id: string) => {
    setState((s) => {
      const task = s.tasks.find((t) => t.id === id);
      if (!task) return s;
      const updated: Task = { ...task, completed: !task.completed, completedAt: !task.completed ? nowIso() : null, updatedAt: nowIso() };
      tasksStore.put(updated);
      return { ...s, tasks: s.tasks.map((t) => (t.id === id ? updated : t)) };
    });
  }, []);

  // ---------- Preferences / settings ----------------------------------------------
  const updatePreferences = useCallback(async (patch: Partial<UserPreferences>) => {
    setState((s) => {
      const next = UserPreferencesSchema.parse({ ...s.preferences, ...patch });
      kvSet('preferences', next);
      return { ...s, preferences: next };
    });
  }, []);

  const updateSettings = useCallback(async (patch: Partial<ApplicationSettings>) => {
    setState((s) => {
      const next = ApplicationSettingsSchema.parse({ ...s.settings, ...patch });
      kvSet('settings', next);
      return { ...s, settings: next };
    });
  }, []);

  // ---------- Images ------------------------------------------------------------
  const saveImage = useCallback(async (blob: Blob, kind: 'original' | 'display' | 'cutout' | 'thumbnail') => {
    const blobKey = `img-${newId()}`;
    await saveImageBlob(blobKey, blob);
    return { id: newId(), blobKey, kind };
  }, []);

  // ---------- Export / Import ------------------------------------------------------
  const exportData = useCallback(async (): Promise<Blob> => {
    const imageKeys = new Set<string>();
    [...state.garments.flatMap((g) => g.images.map((i) => i.blobKey)), ...state.foodItems.map((f) => f.image?.blobKey), ...state.recipes.map((r) => r.image?.blobKey), ...state.outfits.map((o) => o.sourceImage?.blobKey)]
      .filter((k): k is string => !!k)
      .forEach((k) => imageKeys.add(k));

    const images: ExportBundle['images'] = [];
    for (const key of imageKeys) {
      const blob = await getImageBlob(key);
      if (!blob) continue;
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      images.push({ id: key, blobKey: key, kind: 'image', dataUrl });
    }

    const bundle: ExportBundle = {
      version: 1,
      exportedAt: nowIso(),
      garments: state.garments,
      outfits: state.outfits,
      outfitFeedback: state.outfitFeedback,
      laundryGroups: state.laundryGroups,
      washRecords: state.washRecords,
      foodItems: state.foodItems,
      recipes: state.recipes,
      mealPlans: state.mealPlans,
      shoppingItems: state.shoppingItems,
      calendarEvents: state.calendarEvents,
      tasks: state.tasks,
      reminders: state.reminders,
      preferences: state.preferences,
      settings: state.settings,
      images
    };
    // Never include the Gemini API key -- it is kept outside persisted state entirely.
    return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  }, [state]);

  const importData = useCallback(async (file: File): Promise<{ ok: boolean; message: string }> => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = ExportBundleSchema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, message: `Invalid backup file: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}` };
      }
      const bundle = parsed.data;
      for (const img of bundle.images) {
        const blob = await (await fetch(img.dataUrl)).blob();
        await saveImageBlob(img.blobKey, blob);
      }
      await Promise.all([
        garmentsStore.putMany(bundle.garments),
        outfitsStore.putMany(bundle.outfits),
        outfitFeedbackStore.putMany(bundle.outfitFeedback),
        laundryGroupsStore.putMany(bundle.laundryGroups),
        washRecordsStore.putMany(bundle.washRecords),
        foodItemsStore.putMany(bundle.foodItems),
        recipesStore.putMany(bundle.recipes),
        mealPlansStore.putMany(bundle.mealPlans),
        shoppingItemsStore.putMany(bundle.shoppingItems),
        calendarEventsStore.putMany(bundle.calendarEvents),
        tasksStore.putMany(bundle.tasks),
        remindersStore.putMany(bundle.reminders)
      ]);
      await kvSet('preferences', bundle.preferences);
      await kvSet('settings', bundle.settings);
      setState((s) => ({
        ...s,
        garments: bundle.garments,
        outfits: bundle.outfits,
        outfitFeedback: bundle.outfitFeedback,
        laundryGroups: bundle.laundryGroups,
        washRecords: bundle.washRecords,
        foodItems: bundle.foodItems,
        recipes: bundle.recipes,
        mealPlans: bundle.mealPlans,
        shoppingItems: bundle.shoppingItems,
        calendarEvents: bundle.calendarEvents,
        tasks: bundle.tasks,
        reminders: bundle.reminders,
        preferences: bundle.preferences,
        settings: bundle.settings
      }));
      return { ok: true, message: 'Backup restored successfully.' };
    } catch (err) {
      return { ok: false, message: `Could not read backup file: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, []);

  const resetAllData = useCallback(async () => {
    await db.wipeAllData();
    await kvSet(SEED_FLAG_KEY, false);
    setState((s) => ({
      ...s,
      garments: [],
      outfits: [],
      outfitFeedback: [],
      laundryGroups: [],
      washRecords: [],
      foodItems: [],
      recipes: [],
      mealPlans: [],
      shoppingItems: [],
      calendarEvents: [],
      tasks: [],
      reminders: []
    }));
  }, []);

  const api: AppApi = useMemo(
    () => ({
      ...state,
      pushToast,
      dismissToast,
      addGarment: garmentCrud.add,
      updateGarment,
      deleteGarment: garmentCrud.remove,
      addOutfit: outfitCrud.add,
      updateOutfit: outfitCrud.update,
      deleteOutfit: outfitCrud.remove,
      markOutfitWorn,
      addOutfitFeedback,
      addLaundryGroup: laundryGroupCrud.add,
      updateLaundryGroup: laundryGroupCrud.update,
      deleteLaundryGroup: laundryGroupCrud.remove,
      assignGarmentToGroup,
      completeWash,
      addFoodItem: foodCrud.add,
      updateFoodItem: foodCrud.update,
      deleteFoodItem: foodCrud.remove,
      addRecipe: recipeCrud.add,
      updateRecipe: recipeCrud.update,
      deleteRecipe: recipeCrud.remove,
      prepareMeal,
      addMealPlan: mealPlanCrud.add,
      updateMealPlan: mealPlanCrud.update,
      deleteMealPlan: mealPlanCrud.remove,
      addShoppingItem: shoppingCrud.add,
      updateShoppingItem: shoppingCrud.update,
      deleteShoppingItem: shoppingCrud.remove,
      addFoodFromShoppingItem,
      runShoppingReconciliation,
      addCalendarEvent: eventCrud.add,
      updateCalendarEvent: eventCrud.update,
      deleteCalendarEvent: eventCrud.remove,
      importEvents,
      addTask: taskCrud.add,
      updateTask: taskCrud.update,
      deleteTask: taskCrud.remove,
      toggleTaskComplete,
      updatePreferences,
      updateSettings,
      exportData,
      importData,
      resetAllData,
      saveImage
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
