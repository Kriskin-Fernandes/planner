import { describe, it, expect } from 'vitest';
import {
  applyWearToGarments,
  completeWash,
  consumeIngredients,
  reconcileShoppingList,
  checkIngredientAvailability,
  evaluateRecipeAvailability,
  expiryRisk,
  isSafeToConsume,
  detectClashes,
  expandEventOccurrences,
  groupTasks,
  recommendOutfits,
  findCareConflicts,
  recommendWashSettings,
  filterStoresNearRoute,
  allocateItemsToStores,
  eventsToIcs,
  icsToEvents
} from '../../src/services';
import { newId, nowIso, type Garment, type FoodItem, type Recipe, type ShoppingItem, type CalendarEvent, type Task, type StoreCandidate } from '../../src/types';

// ---------- fixtures --------------------------------------------------------

function makeGarment(overrides: Partial<Garment> = {}): Garment {
  const now = nowIso();
  return {
    id: newId(),
    name: 'Blue T-Shirt',
    category: 'tops',
    layerRole: 'base',
    mainColor: '#2255aa',
    secondaryColors: [],
    pattern: 'solid',
    texture: 'smooth',
    thickness: 'medium',
    warmthScore: 4,
    features: {},
    careLabel: {},
    maxWearsBeforeWash: 2,
    wearsSinceWash: 0,
    laundryStatus: 'clean',
    laundryGroupId: null,
    lastWornAt: null,
    attributeSource: 'user',
    images: [],
    isGeneratedApproximation: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeFood(overrides: Partial<FoodItem> = {}): FoodItem {
  const now = nowIso();
  return {
    id: newId(),
    name: 'Milk',
    expirationDate: null,
    dateCertainty: 'unknown',
    purchaseDate: now,
    quantity: 1,
    unit: 'l',
    estimatedRemainingFraction: 1,
    storageLocation: 'fridge',
    source: 'manual',
    userCorrected: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ---------- Wardrobe: wear / laundry propagation ----------------------------

describe('applyWearToGarments', () => {
  it('increments wear count and flips to needs-wash at the max-wear threshold', () => {
    const g = makeGarment({ maxWearsBeforeWash: 1, wearsSinceWash: 0 });
    const [updated] = applyWearToGarments([g], new Set([g.id]));
    expect(updated.wearsSinceWash).toBe(1);
    expect(updated.laundryStatus).toBe('needs-wash');
    expect(updated.lastWornAt).not.toBeNull();
  });

  it('leaves garments not in the outfit untouched', () => {
    const g = makeGarment();
    const [updated] = applyWearToGarments([g], new Set(['someone-else']));
    expect(updated).toEqual(g);
  });

  it('does not double count a single wear event', () => {
    const g = makeGarment({ maxWearsBeforeWash: 5, wearsSinceWash: 0 });
    const [updated] = applyWearToGarments([g], new Set([g.id]));
    expect(updated.wearsSinceWash).toBe(1);
  });
});

describe('completeWash', () => {
  it('resets wear count and marks garments clean', () => {
    const g = makeGarment({ wearsSinceWash: 3, laundryStatus: 'needs-wash', laundryGroupId: 'grp-1' });
    const [updated] = completeWash([g], new Set([g.id]));
    expect(updated.wearsSinceWash).toBe(0);
    expect(updated.laundryStatus).toBe('clean');
    expect(updated.laundryGroupId).toBeNull();
  });
});

describe('findCareConflicts / recommendWashSettings', () => {
  it('flags a dry-clean-only item mixed with a normal item', () => {
    const a = makeGarment({ careLabel: { dryCleanOnly: true } });
    const b = makeGarment({ careLabel: {} });
    const conflicts = findCareConflicts([a, b]);
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('never recommends a wash temperature above the lowest care-label maximum', () => {
    const a = makeGarment({ careLabel: { maxWashTempC: 30 } });
    const b = makeGarment({ careLabel: { maxWashTempC: 60 } });
    const settings = recommendWashSettings([a, b]);
    expect(settings.washTempC).toBeLessThanOrEqual(30);
  });
});

// ---------- Outfit recommendation -------------------------------------------


// ---------- Fridge: ingredient availability & consumption -------------------

describe('checkIngredientAvailability', () => {
  it('is red when nothing matches', () => {
    const status = checkIngredientAvailability({ id: 'i1', name: 'Eggs', quantity: 2, unit: 'pcs', substitutes: [] }, []);
    expect(status).toBe('red');
  });

  it('is green when enough stock exists', () => {
    const inv = [makeFood({ name: 'Flour', quantity: 1000, unit: 'g', estimatedRemainingFraction: 1 })];
    const status = checkIngredientAvailability({ id: 'i1', name: 'Flour', quantity: 200, unit: 'g', substitutes: [] }, inv);
    expect(status).toBe('green');
  });

  it('is amber when stock is below the required quantity', () => {
    const inv = [makeFood({ name: 'Flour', quantity: 100, unit: 'g', estimatedRemainingFraction: 1 })];
    const status = checkIngredientAvailability({ id: 'i1', name: 'Flour', quantity: 200, unit: 'g', substitutes: [] }, inv);
    expect(status).toBe('amber');
  });
});

describe('consumeIngredients', () => {
  it('reduces remaining fraction after consuming a recipe', () => {
    const inv = [makeFood({ name: 'Rice', quantity: 1000, unit: 'g', estimatedRemainingFraction: 1 })];
    const next = consumeIngredients(inv, [{ id: 'i1', name: 'Rice', quantity: 500, unit: 'g', substitutes: [] }]);
    expect(next[0].estimatedRemainingFraction).toBeCloseTo(0.5, 1);
  });

  it('never goes below zero remaining', () => {
    const inv = [makeFood({ name: 'Rice', quantity: 100, unit: 'g', estimatedRemainingFraction: 1 })];
    const next = consumeIngredients(inv, [{ id: 'i1', name: 'Rice', quantity: 9999, unit: 'g', substitutes: [] }]);
    expect(next[0].estimatedRemainingFraction).toBe(0);
  });
});

describe('expiryRisk / isSafeToConsume', () => {
  it('flags an overdue use-by date as expired and unsafe', () => {
    const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
    const item = makeFood({ expirationDate: yesterday, dateCertainty: 'use-by' });
    expect(expiryRisk(item)).toBe('expired');
    expect(isSafeToConsume(item)).toBe(false);
  });

  it('does not assert a best-before item is unsafe (quality signal only)', () => {
    const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
    const item = makeFood({ expirationDate: yesterday, dateCertainty: 'best-before' });
    expect(expiryRisk(item)).toBe('expired');
    expect(isSafeToConsume(item)).toBe(true);
  });
});

// ---------- Shopping list reconciliation ------------------------------------

describe('reconcileShoppingList', () => {
  it('adds missing recipe ingredients once, without duplicating on repeat calls', () => {
    const now = nowIso();
    const recipe: Recipe = {
      id: 'r1',
      name: 'Pasta',
      servings: 2,
      remainingServings: 0,
      ingredients: [{ id: 'ing1', name: 'Pasta', quantity: 500, unit: 'g', substitutes: [] }],
      steps: [],
      lastMadeAt: null,
      recurrence: { freq: 'none', interval: 1 },
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    let list: ShoppingItem[] = [];
    list = reconcileShoppingList([recipe], ['r1'], [], list);
    expect(list.filter((i) => i.name === 'Pasta')).toHaveLength(1);
    // Calling again with the same inputs must not duplicate the entry.
    list = reconcileShoppingList([recipe], ['r1'], [], list);
    expect(list.filter((i) => i.name === 'Pasta')).toHaveLength(1);
  });

  it('adds a low-stock item when remaining fraction is below 20%', () => {
    const food = makeFood({ name: 'Butter', estimatedRemainingFraction: 0.1 });
    const list = reconcileShoppingList([], [], [food], []);
    expect(list.some((i) => i.name === 'Butter' && i.reason === 'low-stock')).toBe(true);
  });
});

// ---------- Calendar: clash detection & recurrence --------------------------

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = nowIso();
  return {
    id: newId(),
    title: 'Event',
    start: now,
    end: now,
    allDay: false,
    recurrence: { freq: 'none', interval: 1 },
    category: 'other',
    reminderMinutesBefore: [],
    externalSource: 'local',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('detectClashes', () => {
  it('detects two overlapping events', () => {
    const a = makeEvent({ start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T11:00:00.000Z' });
    const b = makeEvent({ start: '2026-11-02T10:30:00.000Z', end: '2026-11-02T11:30:00.000Z' });
    const clashes = detectClashes([a, b], new Date('2026-11-01'), new Date('2026-11-03'));
    expect(clashes).toHaveLength(1);
  });

  it('does not flag back-to-back non-overlapping events', () => {
    const a = makeEvent({ start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T11:00:00.000Z' });
    const b = makeEvent({ start: '2026-11-02T11:00:00.000Z', end: '2026-11-02T12:00:00.000Z' });
    const clashes = detectClashes([a, b], new Date('2026-11-01'), new Date('2026-11-03'));
    expect(clashes).toHaveLength(0);
  });
});

describe('expandEventOccurrences', () => {
  it('expands a weekly recurring event into multiple occurrences within range', () => {
    const e = makeEvent({
      start: '2026-11-02T09:00:00.000Z',
      end: '2026-11-02T10:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1 }
    });
    const occurrences = expandEventOccurrences(e, new Date('2026-11-01'), new Date('2026-11-30'));
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });
});

describe('ICS export / import', () => {
  it('round-trips a simple event through ICS text', () => {
    const e = makeEvent({ title: 'Lecture', location: 'Room 101', start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T10:00:00.000Z' });
    const ics = eventsToIcs([e]);
    expect(ics).toContain('BEGIN:VEVENT');
    const imported = icsToEvents(ics);
    expect(imported).toHaveLength(1);
    expect(imported[0].title).toBe('Lecture');
    expect(imported[0].location).toBe('Room 101');
  });
});

// ---------- Task grouping ----------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = nowIso();
  return {
    id: newId(),
    title: 'Task',
    category: 'general',
    dueAt: null,
    priority: 'medium',
    recurrence: { freq: 'none', interval: 1 },
    completed: false,
    completedAt: null,
    reminderMinutesBefore: [],
    linkedShoppingItemIds: [],
    classificationSource: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('groupTasks', () => {
  it('groups tasks sharing the same location together', () => {
    const t1 = makeTask({ title: 'Buy milk', location: 'Supermarket' });
    const t2 = makeTask({ title: 'Buy eggs', location: 'Supermarket' });
    const groups = groupTasks([t1, t2], []);
    const g = groups.find((gr) => gr.label === 'Supermarket');
    expect(g?.tasks).toHaveLength(2);
  });

  it('excludes completed tasks from groups', () => {
    const t1 = makeTask({ completed: true, location: 'Gym' });
    const groups = groupTasks([t1], []);
    expect(groups.find((g) => g.label === 'Gym')).toBeUndefined();
  });
});

// ---------- Smart Shopping: route-stop allocation ----------------------------

function makeStore(overrides: Partial<StoreCandidate> = {}): StoreCandidate {
  return { id: newId(), name: 'Store', point: { lat: 0, lon: 0 }, detourMeters: 0, distanceFromRouteMeters: 0, osmTags: {}, assignedItemIds: [], ...overrides };
}

describe('filterStoresNearRoute / allocateItemsToStores', () => {
  it('filters out stores farther than the corridor width', () => {
    const route = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }];
    const near = makeStore({ point: { lat: 0.001, lon: 0.5 } });
    const far = makeStore({ point: { lat: 5, lon: 5 } });
    const result = filterStoresNearRoute([near, far], route, 5000);
    expect(result.map((s) => s.id)).toEqual([near.id]);
  });

  it('allocates items across stops without exceeding the per-stop cap', () => {
    const stores = [makeStore({ id: 's1' }), makeStore({ id: 's2' })];
    const items: ShoppingItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      name: `Item ${i}`,
      quantity: 1,
      unit: 'pcs',
      purchased: false,
      reason: 'manual',
      priceSource: 'unknown',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }));
    const allocation = allocateItemsToStores(items, stores, 2, 3);
    const total = Object.values(allocation).reduce((sum, ids) => sum + ids.length, 0);
    expect(total).toBe(5);
    for (const ids of Object.values(allocation)) {
      expect(ids.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('evaluateRecipeAvailability', () => {
  it('is red overall when any ingredient is missing', () => {
    const now = nowIso();
    const recipe: Recipe = {
      id: 'r1',
      name: 'Omelette',
      servings: 1,
      remainingServings: 0,
      ingredients: [{ id: 'i1', name: 'Eggs', quantity: 2, unit: 'pcs', substitutes: [] }],
      steps: [],
      lastMadeAt: null,
      recurrence: { freq: 'none', interval: 1 },
      tags: [],
      createdAt: now,
      updatedAt: now
    };
    const result = evaluateRecipeAvailability(recipe, []);
    expect(result.overall).toBe('red');
  });
});
