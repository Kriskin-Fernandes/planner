/**
 * Central typed data model for the whole app, with Zod schemas used to
 * validate: imported JSON backups, Gemini structured responses, and
 * Open Food Facts / OSM API responses before they ever touch app state.
 */
import { z } from 'zod';

export const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
export const nowIso = (): string => new Date().toISOString();

// ----------------------------------------------------------------------------
// Shared primitives
// ----------------------------------------------------------------------------

export const AttributeSourceSchema = z.enum(['user', 'ai-local', 'ai-gemini']);
export type AttributeSource = z.infer<typeof AttributeSourceSchema>;

export const StoredImageSchema = z.object({
  id: z.string(),
  /** 'original' preserves the untouched capture; others are derived. */
  kind: z.enum(['original', 'display', 'thumbnail', 'cutout']),
  blobKey: z.string().optional(),
  /** Public catalogue image URL; user uploaded photos continue using blobKey. */
  url: z.string().url().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type StoredImage = z.infer<typeof StoredImageSchema>;

export const RecurrenceSchema = z.object({
  freq: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  interval: z.number().int().min(1).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  until: z.string().nullable().optional(),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const NutritionSchema = z.object({
  calories: z.number().optional(),
  proteinG: z.number().optional(),
  carbsG: z.number().optional(),
  fatG: z.number().optional(),
  fiberG: z.number().optional(),
  sugarG: z.number().optional(),
  sodiumMg: z.number().optional(),
  servingSize: z.string().optional(),
});
export type Nutrition = z.infer<typeof NutritionSchema>;

// ----------------------------------------------------------------------------
// Wardrobe: Garment
// ----------------------------------------------------------------------------

export const GarmentCategorySchema = z.enum(['tops', 'bottoms', 'footwear', 'headwear', 'outerwear', 'accessories', 'other']);
export type GarmentCategory = z.infer<typeof GarmentCategorySchema>;

export const LayeringRoleSchema = z.enum(['base', 'middle', 'outer', 'flexible']);
export type LayeringRole = z.infer<typeof LayeringRoleSchema>;

export const LaundryStatusSchema = z.enum(['clean', 'worn', 'needs-wash', 'in-wash', 'drying']);
export type LaundryStatus = z.infer<typeof LaundryStatusSchema>;

export const CareLabelSchema = z.object({
  maxWashTempC: z.number().nullable().optional(),
  machineWashable: z.boolean().optional(),
  handWashOnly: z.boolean().optional(),
  noTumbleDry: z.boolean().optional(),
  noBleach: z.boolean().optional(),
  dryCleanOnly: z.boolean().optional(),
  ironMaxTempC: z.number().nullable().optional(),
  notes: z.string().optional(),
});
export type CareLabel = z.infer<typeof CareLabelSchema>;

export const GarmentFeaturesSchema = z.object({
  hood: z.boolean().optional(),
  waterproof: z.boolean().optional(),
  insulated: z.boolean().optional(),
  moistureWicking: z.boolean().optional(),
});
export type GarmentFeatures = z.infer<typeof GarmentFeaturesSchema>;

export const GarmentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  category: GarmentCategorySchema,
  layerRole: LayeringRoleSchema,
  mainColor: z.string(),
  secondaryColors: z.array(z.string()).default([]),
  pattern: z.string().default('solid'),
  texture: z.string().default('smooth'),
  estimatedMaterial: z.string().optional(),
  thickness: z.enum(['light', 'medium', 'heavy']).default('medium'),
  warmthScore: z.number().min(0).max(10),
  features: GarmentFeaturesSchema.default({}),
  careLabel: CareLabelSchema.default({}),
  maxWearsBeforeWash: z.number().int().min(1).default(1),
  wearsSinceWash: z.number().int().min(0).default(0),
  laundryStatus: LaundryStatusSchema.default('clean'),
  laundryGroupId: z.string().nullable().default(null),
  lastWornAt: z.string().nullable().default(null),
  rating: z.number().min(1).max(5).nullable().optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  attributeSource: AttributeSourceSchema.default('user'),
  images: z.array(StoredImageSchema).default([]),
  isGeneratedApproximation: z.boolean().default(false),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Garment = z.infer<typeof GarmentSchema>;

// ----------------------------------------------------------------------------
// Wardrobe: Outfit
// ----------------------------------------------------------------------------

export const OutfitLayerSchema = z.object({
  id: z.string(),
  category: GarmentCategorySchema,
  garmentIds: z.array(z.string()).default([]),
});
export type OutfitLayer = z.infer<typeof OutfitLayerSchema>;

export const OutfitMetricsSchema = z.object({
  colorHarmony: z.number().min(0).max(100),
  estimatedWarmth: z.number().min(0).max(10),
  formality: z.number().min(0).max(10).optional(),
});
export type OutfitMetrics = z.infer<typeof OutfitMetricsSchema>;

export const AppearancePrefsSchema = z.object({
  build: z.enum(['slim', 'average', 'athletic', 'plus']).default('average'),
  hair: z.string().default('short-brown'),
  skinTone: z.string().default('#caa37b'),
  accessory: z.string().optional(),
});
export type AppearancePrefs = z.infer<typeof AppearancePrefsSchema>;

export const OutfitSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  layers: z.array(OutfitLayerSchema).min(1),
  favorite: z.boolean().default(false),
  rating: z.number().min(1).max(5).nullable().optional(),
  lastWornAt: z.string().nullable().default(null),
  wearCount: z.number().int().min(0).default(0),
  metrics: OutfitMetricsSchema,
  sourceImage: StoredImageSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Outfit = z.infer<typeof OutfitSchema>;

export const OutfitFeedbackSchema = z.object({
  id: z.string(),
  outfitId: z.string(),
  wornAt: z.string(),
  comfortRating: z.number().min(1).max(5).optional(),
  warmthFeedback: z.enum(['too-cold', 'just-right', 'too-warm']).optional(),
  weatherTempC: z.number().optional(),
});
export type OutfitFeedback = z.infer<typeof OutfitFeedbackSchema>;

// ----------------------------------------------------------------------------
// Wardrobe: Laundry
// ----------------------------------------------------------------------------

export const LaundryGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean().default(false),
  garmentIds: z.array(z.string()).default([]),
  washTempC: z.number().default(30),
  cycle: z.string().default('normal'),
  spin: z.enum(['none', 'low', 'medium', 'high']).default('medium'),
  dryingRecommendation: z.string().default('line-dry'),
  userCorrected: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LaundryGroup = z.infer<typeof LaundryGroupSchema>;

export const WashRecordSchema = z.object({
  id: z.string(),
  laundryGroupId: z.string(),
  garmentIds: z.array(z.string()),
  completedAt: z.string(),
  washTempC: z.number(),
  cycle: z.string(),
});
export type WashRecord = z.infer<typeof WashRecordSchema>;

// ----------------------------------------------------------------------------
// Fridge: Food
// ----------------------------------------------------------------------------

export const StorageLocationSchema = z.enum(['fridge', 'freezer', 'cupboard']);
export type StorageLocation = z.infer<typeof StorageLocationSchema>;

export const DateCertaintySchema = z.enum(['use-by', 'best-before', 'unknown']);
export type DateCertainty = z.infer<typeof DateCertaintySchema>;

export const FoodItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  image: StoredImageSchema.optional(),
  expirationDate: z.string().nullable(),
  dateCertainty: DateCertaintySchema.default('unknown'),
  purchaseDate: z.string().nullable(),
  quantity: z.number().min(0).default(1),
  unit: z.string().default('pcs'),
  estimatedRemainingFraction: z.number().min(0).max(1).default(1),
  nutrition: NutritionSchema.optional(),
  description: z.string().optional(),
  storageLocation: StorageLocationSchema.default('fridge'),
  barcode: z.string().optional(),
  source: z.enum(['manual', 'barcode', 'receipt', 'photo']).default('manual'),
  userCorrected: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FoodItem = z.infer<typeof FoodItemSchema>;

// ----------------------------------------------------------------------------
// Fridge: Meals / Recipes
// ----------------------------------------------------------------------------

export const IngredientSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  quantity: z.number().min(0),
  unit: z.string().default('pcs'),
  linkedFoodItemId: z.string().nullable().optional(),
  substitutes: z.array(z.string()).default([]),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  image: StoredImageSchema.optional(),
  servings: z.number().min(1).default(2),
  remainingServings: z.number().min(0).default(0),
  ingredients: z.array(IngredientSchema).default([]),
  steps: z.array(z.string()).default([]),
  nutrition: NutritionSchema.optional(),
  storageInfo: z.string().optional(),
  lastMadeAt: z.string().nullable().default(null),
  recurrence: RecurrenceSchema.default({ freq: 'none', interval: 1 }),
  prepMinutes: z.number().optional(),
  tags: z.array(z.string()).default([]),
  sourceUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const MealPlanSchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  scheduledFor: z.string(),
  servingsPlanned: z.number().min(1).default(1),
  status: z.enum(['planned', 'completed', 'skipped']).default('planned'),
  createdAt: z.string(),
});
export type MealPlan = z.infer<typeof MealPlanSchema>;

// ----------------------------------------------------------------------------
// Fridge: Shopping
// ----------------------------------------------------------------------------

export const ShoppingItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  quantity: z.number().min(0).default(1),
  unit: z.string().default('pcs'),
  purchased: z.boolean().default(false),
  reason: z.enum(['recipe', 'low-stock', 'manual', 'expired-replace']).default('manual'),
  linkedRecipeId: z.string().nullable().optional(),
  linkedFoodItemId: z.string().nullable().optional(),
  estimatedPrice: z.number().nullable().optional(),
  priceSource: z.enum(['unknown', 'estimated', 'verified']).default('unknown'),
  assignedShopId: z.string().nullable().optional(),
  assignedShopName: z.string().optional(),
  assignedShopLocation: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

// ----------------------------------------------------------------------------
// Planner: Calendar / Tasks
// ----------------------------------------------------------------------------

export const CalendarEventSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  locationTag: z.string().optional(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean().default(false),
  recurrence: RecurrenceSchema.default({ freq: 'none', interval: 1 }),
  category: z.enum(['class', 'assignment', 'personal', 'other']).default('other'),
  reminderMinutesBefore: z.array(z.number().int().min(0)).default([]),
  externalSource: z.enum(['local', 'ics-import', 'google', 'outlook']).default('local'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('general'),
  dueAt: z.string().nullable().default(null),
  location: z.string().optional(),
  locationTag: z.string().optional(),
  priority: TaskPrioritySchema.default('medium'),
  recurrence: RecurrenceSchema.default({ freq: 'none', interval: 1 }),
  completed: z.boolean().default(false),
  completedAt: z.string().nullable().default(null),
  reminderMinutesBefore: z.array(z.number().int().min(0)).default([]),
  linkedCalendarEventId: z.string().nullable().optional(),
  linkedShoppingItemIds: z.array(z.string()).default([]),
  linkedRecipeId: z.string().nullable().optional(),
  classificationSource: AttributeSourceSchema.default('user'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ReminderSchema = z.object({
  id: z.string(),
  refType: z.enum(['task', 'event', 'laundry']),
  refId: z.string(),
  fireAt: z.string(),
  message: z.string(),
  fired: z.boolean().default(false),
  dismissed: z.boolean().default(false),
});
export type Reminder = z.infer<typeof ReminderSchema>;

// ----------------------------------------------------------------------------
// Smart Shopping / Geo
// ----------------------------------------------------------------------------

export const GeoPointSchema = z.object({ lat: z.number(), lon: z.number() });
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const TravelModeSchema = z.enum(['walking', 'cycling', 'driving', 'public-transport']);
export type TravelMode = z.infer<typeof TravelModeSchema>;

export const AvailabilityStatusSchema = z.enum(['green', 'amber', 'red']);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

export const StoreCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  point: GeoPointSchema,
  detourMeters: z.number().default(0),
  distanceFromRouteMeters: z.number().default(0),
  osmTags: z.record(z.string(), z.string()).default({}),
  assignedItemIds: z.array(z.string()).default([]),
});
export type StoreCandidate = z.infer<typeof StoreCandidateSchema>;

export const SmartShoppingPlanSchema = z.object({
  id: z.string(),
  startQuery: z.string(),
  destinationQuery: z.string(),
  start: GeoPointSchema.nullable(),
  destination: GeoPointSchema.nullable(),
  travelMode: TravelModeSchema.default('walking'),
  deadline: z.string().nullable(),
  routeGeometry: z.array(GeoPointSchema).default([]),
  routeDistanceM: z.number().default(0),
  routeDurationS: z.number().default(0),
  corridorWidthM: z.number().default(600),
  candidates: z.array(StoreCandidateSchema).default([]),
  itemIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type SmartShoppingPlan = z.infer<typeof SmartShoppingPlanSchema>;

// ----------------------------------------------------------------------------
// Preferences / Settings
// ----------------------------------------------------------------------------

export const UserPreferencesSchema = z.object({
  warmthBias: z.number().min(-3).max(3).default(2),
  dailyOutfitGarmentIds: z.array(z.string()).default([]),
  preferredUnits: z.enum(['metric', 'imperial']).default('metric'),
  dietaryPreferences: z.array(z.string()).default([]),
  defaultTravelMode: TravelModeSchema.default('public-transport'),
  preferredStores: z.array(z.string()).default([]),
  appearance: AppearancePrefsSchema.default({ build: 'average', hair: 'short-brown', skinTone: '#caa37b' }),
  laundryCorrections: z.record(z.string(), z.string()).default({}),
  locationTags: z.record(z.string(), z.string()).default({ Uni: 'Imperial College London' }),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const GeminiModelConfigSchema = z.object({
  textModel: z.string().default('gemini-3.8-flash'),
  visionModel: z.string().default('gemini-3.8-flash'),
});
export type GeminiModelConfig = z.infer<typeof GeminiModelConfigSchema>;

export const ApplicationSettingsSchema = z.object({
  geminiRememberKey: z.boolean().default(true),
  geminiModels: GeminiModelConfigSchema.default({ textModel: 'gemini-3.8-flash', visionModel: 'gemini-3.8-flash' }),
  googleMapsApiKey: z.string().default(''),
  notificationsEnabled: z.boolean().default(false),
  useLocalVisionModel: z.boolean().default(false),
  osrmBaseUrl: z.string().default('https://router.project-osrm.org'),
  overpassBaseUrl: z.string().default('https://overpass-api.de/api/interpreter'),
  photonBaseUrl: z.string().default('https://photon.komoot.io'),
  onboardingSeen: z.boolean().default(false),
  homeAddress: z.string().default('42 Redfield Lane, London, SW5 0RQ'),
});
export type ApplicationSettings = z.infer<typeof ApplicationSettingsSchema>;

// ----------------------------------------------------------------------------
// Export / import bundle
// ----------------------------------------------------------------------------

export const ExportImageSchema = z.object({
  id: z.string(),
  blobKey: z.string(),
  kind: z.string(),
  dataUrl: z.string(),
});
export type ExportImage = z.infer<typeof ExportImageSchema>;

export const ExportBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  garments: z.array(GarmentSchema),
  outfits: z.array(OutfitSchema),
  outfitFeedback: z.array(OutfitFeedbackSchema),
  laundryGroups: z.array(LaundryGroupSchema),
  washRecords: z.array(WashRecordSchema),
  foodItems: z.array(FoodItemSchema),
  recipes: z.array(RecipeSchema),
  mealPlans: z.array(MealPlanSchema),
  shoppingItems: z.array(ShoppingItemSchema),
  calendarEvents: z.array(CalendarEventSchema),
  tasks: z.array(TaskSchema),
  reminders: z.array(ReminderSchema),
  preferences: UserPreferencesSchema,
  settings: ApplicationSettingsSchema,
  /** Images are embedded as base64 data URLs so a backup file is self-contained. */
  images: z.array(ExportImageSchema).default([]),
});
export type ExportBundle = z.infer<typeof ExportBundleSchema>;

// Note: the export bundle intentionally has no field for the Gemini API key.
// Keys must never be written into exported application data.

// ----------------------------------------------------------------------------
// Gemini structured-output schemas (validated before any result is used)
// ----------------------------------------------------------------------------

export const GeminiGarmentAnalysisSchema = z.object({
  name: z.string().default('Garment'),
  category: GarmentCategorySchema.default('other'),
  layerRole: LayeringRoleSchema.default('flexible'),
  mainColor: z.string().default('#888888'),
  secondaryColors: z.array(z.string()).default([]),
  pattern: z.string().default('solid'),
  texture: z.string().default('smooth'),
  material: z.string().optional(),
  thickness: z.enum(['light', 'medium', 'heavy']).default('medium'),
  warmthScore: z.number().min(0).max(10).default(5),
  features: GarmentFeaturesSchema.default({}),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type GeminiGarmentAnalysis = z.infer<typeof GeminiGarmentAnalysisSchema>;

export const GeminiMultiGarmentSchema = z.object({
  garments: z.array(GeminiGarmentAnalysisSchema).default([]),
  ambiguousNotes: z.array(z.string()).default([]),
});
export type GeminiMultiGarment = z.infer<typeof GeminiMultiGarmentSchema>;

export const GeminiOutfitRequestSchema = z.object({
  categories: z.array(GarmentCategorySchema).default([]),
  colors: z.array(z.string()).default([]),
  maxWarmth: z.number().optional(),
  minWarmth: z.number().optional(),
  occasion: z.string().optional(),
  mustInclude: z.array(z.string()).default([]),
  mustExclude: z.array(z.string()).default([]),
});
export type GeminiOutfitRequest = z.infer<typeof GeminiOutfitRequestSchema>;

export const GeminiReceiptItemSchema = z.object({
  name: z.string(),
  quantity: z.number().default(1),
  unit: z.string().default('pcs'),
  estimatedPrice: z.number().optional(),
});
export type GeminiReceiptItem = z.infer<typeof GeminiReceiptItemSchema>;

export const GeminiReceiptSchema = z.object({
  items: z.array(GeminiReceiptItemSchema).default([]),
  storeName: z.string().optional(),
  purchaseDate: z.string().optional(),
});
export type GeminiReceipt = z.infer<typeof GeminiReceiptSchema>;

export const GeminiRecipeExtractionSchema = z.object({
  name: z.string().default('Imported recipe'),
  servings: z.number().min(1).default(2),
  ingredients: z
    .array(z.object({ name: z.string(), quantity: z.number().default(1), unit: z.string().default('pcs') }))
    .default([]),
  steps: z.array(z.string()).default([]),
  prepMinutes: z.number().optional(),
});
export type GeminiRecipeExtraction = z.infer<typeof GeminiRecipeExtractionSchema>;

export const GeminiMealSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        usesIngredients: z.array(z.string()).default([]),
        missingIngredients: z.array(z.string()).default([]),
        estimatedPrepMinutes: z.number().optional(),
        reason: z.string().default(''),
      })
    )
    .default([]),
});
export type GeminiMealSuggestion = z.infer<typeof GeminiMealSuggestionSchema>;

export const GeminiTaskClassificationSchema = z.object({
  title: z.string(),
  category: z.string().default('general'),
  priority: TaskPrioritySchema.default('medium'),
  dueAt: z.string().nullable().default(null),
  location: z.string().nullable().optional(),
  recurrence: RecurrenceSchema.default({ freq: 'none', interval: 1 }),
});
export type GeminiTaskClassification = z.infer<typeof GeminiTaskClassificationSchema>;
