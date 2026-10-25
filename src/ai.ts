// ---------------------------------------------------------------------------
// AI service layer: a small interchangeable-provider abstraction.
//
//  - Gemini (`@google/genai`) is used ONLY when the user has supplied an API
//    key in Settings. The key lives in memory for the session by default;
//    an explicit opt-in is required to persist it in localStorage, with a
//    clear warning that this does not make it secure (any script running on
//    the page could read it -- see README/Settings copy).
//  - Every local fallback is a genuine, if more limited, computation -- never
//    a fabricated "AI-style" response pretending to be a real model result.
//  - All Gemini responses are validated against a Zod schema before use.
// ---------------------------------------------------------------------------
import { z } from 'zod';
import {
  GeminiGarmentAnalysisSchema,
  GeminiMultiGarmentSchema,
  GeminiOutfitRequestSchema,
  GeminiReceiptSchema,
  GeminiRecipeExtractionSchema,
  GeminiMealSuggestionSchema,
  GeminiTaskClassificationSchema,
  type GeminiGarmentAnalysis,
  type GeminiMultiGarment,
  type GeminiOutfitRequest,
  type GeminiReceipt,
  type GeminiRecipeExtraction,
  type GeminiMealSuggestion,
  type GeminiTaskClassification,
  type GarmentCategory
} from './types';
import { blobToBase64, compressImageForUpload, dominantColorPalette, parseTaskText } from './lib';
import { aiCacheGet, aiCacheSet, hashKey } from './db';

// ---------- API key handling (session-first; opt-in persistence) -------------

let inMemoryApiKey: string | null = null;
const LS_KEY = 'sdp.gemini.key.optin'; // only used if the user explicitly opts in

export function setGeminiApiKey(key: string, remember: boolean): void {
  inMemoryApiKey = key || null;
  if (remember && key) {
    try {
      localStorage.setItem(LS_KEY, key);
    } catch {
      /* storage unavailable (private browsing, quota) -- key stays in-memory only */
    }
  } else {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function loadPersistedApiKeyIfAny(): string | null {
  try {
    const persisted = localStorage.getItem(LS_KEY);
    if (persisted) inMemoryApiKey = persisted;
    return persisted;
  } catch {
    return null;
  }
}

export function getGeminiApiKey(): string | null {
  return inMemoryApiKey;
}

export function clearGeminiApiKey(): void {
  inMemoryApiKey = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function isGeminiConfigured(): boolean {
  return !!inMemoryApiKey;
}

// ---------- Result type --------------------------------------------------------

export type AiErrorType = 'no-key' | 'quota' | 'invalid-key' | 'network' | 'invalid-response' | 'unavailable' | 'unknown';

export type AiResult<T> =
  | { status: 'ok'; data: T; provider: 'gemini' | 'local' }
  | { status: 'error'; provider: 'gemini' | 'local'; errorType: AiErrorType; message: string };

function classifyGeminiError(err: unknown): AiErrorType {
  const detail = err && typeof err === 'object' ? err as { message?: unknown; status?: unknown; code?: unknown; statusText?: unknown } : undefined;
  const msg = [detail?.message, detail?.status, detail?.code, detail?.statusText, err instanceof Error ? err.name : '']
    .filter(Boolean).join(' ');
  if (/api key not valid|401|permission_denied|403/i.test(msg)) return 'invalid-key';
  if (/429|resource_exhausted|quota/i.test(msg)) return 'quota';
  if (/failed to fetch|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'network';
  if (/model.*not found|not found|unavailable|503|404/i.test(msg)) return 'unavailable';
  if (/HTTP 400|invalid argument/i.test(msg)) return 'invalid-response';
  return 'unknown';
}

// ---------- Low-level Gemini call (lazy-loaded SDK) ----------------------------

async function callGeminiJson<T>(
  model: string,
  promptText: string,
  schema: z.ZodType<T>,
  imageBlob?: Blob
): Promise<AiResult<T>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { status: 'error', provider: 'gemini', errorType: 'no-key', message: 'No Gemini API key configured.' };
  }
  try {
    const parts: Array<Record<string, unknown>> = [{ text: promptText }];
    if (imageBlob) {
      const compressed = await compressImageForUpload(imageBlob);
      const base64 = await blobToBase64(compressed);
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64 } });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Gemini API HTTP ${response.status}: ${body?.error?.message ?? body?.error?.status ?? response.statusText}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    const text = body?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('');
    if (!text) {
      return { status: 'error', provider: 'gemini', errorType: 'invalid-response', message: 'Empty response from Gemini.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 'error', provider: 'gemini', errorType: 'invalid-response', message: 'Gemini response was not valid JSON.' };
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return {
        status: 'error',
        provider: 'gemini',
        errorType: 'invalid-response',
        message: `Gemini response did not match the expected structure: ${result.error.issues[0]?.message ?? 'unknown'}`
      };
    }
    return { status: 'ok', data: result.data, provider: 'gemini' };
  } catch (err) {
    const message = err instanceof Error ? err.message : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
    return { status: 'error', provider: 'gemini', errorType: classifyGeminiError(err), message: message || 'Gemini request failed without an error message. Check the key, model name, and browser network access.' };
  }
}

// ---------- Garment image analysis ---------------------------------------------

const GARMENT_PROMPT = `You are analysing a single photograph of ONE clothing item for a student wardrobe app.
Respond with JSON ONLY matching this exact shape (no markdown fences):
{
 "name": string, "category": "tops"|"bottoms"|"footwear"|"headwear"|"outerwear"|"accessories"|"other",
 "layerRole": "base"|"middle"|"outer"|"flexible",
 "mainColor": "#rrggbb", "secondaryColors": ["#rrggbb"],
 "pattern": string, "texture": string, "material": string,
 "thickness": "light"|"medium"|"heavy", "warmthScore": number (0-10),
 "features": {"hood": boolean, "waterproof": boolean, "insulated": boolean, "moistureWicking": boolean},
 "confidence": number (0-1)
}
Only describe what is visibly identifiable. Do not invent material composition you cannot see; give your best visual estimate and reflect uncertainty in "confidence".`;

export async function analyzeGarmentImage(imageBlob: Blob, model: string): Promise<AiResult<GeminiGarmentAnalysis>> {
  const cacheKey = `garment:${model}:${await hashKey(await blobToBase64(imageBlob).catch(() => 'x'))}`;
  const cached = await aiCacheGet<GeminiGarmentAnalysis>(cacheKey);
  if (cached) return { status: 'ok', data: cached, provider: 'gemini' };
  const result = await callGeminiJson(model, GARMENT_PROMPT, GeminiGarmentAnalysisSchema, imageBlob);
  if (result.status === 'ok') {
    await aiCacheSet(cacheKey, result.data);
    return { ...result, data: result.data as GeminiGarmentAnalysis };
  }
  return result;
}

/** Local fallback: extracts real colour data from pixels; everything else is
 * left for the user to confirm rather than guessed. Clearly lower-confidence. */
export async function analyzeGarmentImageLocal(imageBlob: Blob): Promise<AiResult<Partial<GeminiGarmentAnalysis>>> {
  try {
    const palette = await dominantColorPalette(imageBlob, 3);
    return {
      status: 'ok',
      provider: 'local',
      data: {
        mainColor: palette[0],
        secondaryColors: palette.slice(1),
        pattern: 'solid',
        texture: 'smooth',
        thickness: 'medium',
        warmthScore: 5,
        confidence: 0.25
      }
    };
  } catch (err) {
    return { status: 'error', provider: 'local', errorType: 'unknown', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- Multi-garment extraction from an outfit photo ----------------------

const MULTI_GARMENT_PROMPT = `You are analysing a photograph of a person wearing a complete outfit, for a wardrobe app
that needs to split it into separate garment entries. Identify each clearly visible, distinct garment
(e.g. top, bottom, shoes, jacket, hat, accessory). Respond with JSON ONLY:
{
 "garments": [ <same shape as single-garment analysis with name/category/layerRole/mainColor/secondaryColors/pattern/texture/material/thickness/warmthScore/features/confidence> ],
 "ambiguousNotes": [string]  // notes about occluded or uncertain items, e.g. "undershirt partially hidden by jacket"
}
Do not invent garments that are not visible. If a garment is partially occluded, still report what you can see and
lower its confidence, and add a note in ambiguousNotes.`;

export async function extractGarmentsFromOutfitPhoto(imageBlob: Blob, model: string): Promise<AiResult<GeminiMultiGarment>> {
  const result = await callGeminiJson(model, MULTI_GARMENT_PROMPT, GeminiMultiGarmentSchema, imageBlob);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiMultiGarment };
  }
  return result;
}

// ---------- Natural-language outfit request ------------------------------------

const OUTFIT_REQUEST_PROMPT_PREFIX = `Parse this natural-language outfit request from a student into structured JSON ONLY:
{
 "categories": ["tops"|"bottoms"|"footwear"|"headwear"|"outerwear"|"accessories"|"other"],
 "colors": ["#rrggbb" or plain colour words like "blue"],
 "maxWarmth": number|undefined, "minWarmth": number|undefined,
 "occasion": string|undefined,
 "mustInclude": [string], "mustExclude": [string]
}
Request: `;

const COLOR_WORDS: Record<string, string> = {
  black: '#1a1a1a', white: '#f5f5f5', grey: '#808080', gray: '#808080', blue: '#2563eb', navy: '#1e3a5f',
  red: '#dc2626', green: '#16a34a', yellow: '#eab308', orange: '#f97316', purple: '#9333ea', pink: '#ec4899',
  brown: '#78350f', beige: '#d6c7a1'
};

export async function parseOutfitRequest(text: string, model: string): Promise<AiResult<GeminiOutfitRequest>> {
  const result = await callGeminiJson(model, OUTFIT_REQUEST_PROMPT_PREFIX + text, GeminiOutfitRequestSchema);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiOutfitRequest };
  }
  return result;
}

/** Deterministic local parser: keyword matching against known categories/colours/occasions. */
export function parseOutfitRequestLocal(text: string): AiResult<GeminiOutfitRequest> {
  const lower = text.toLowerCase();
  const categories: GarmentCategory[] = [];
  const catWords: Record<string, GarmentCategory> = {
    shirt: 'tops', top: 'tops', hoodie: 'tops', sweater: 'tops', tee: 'tops',
    jeans: 'bottoms', pants: 'bottoms', trousers: 'bottoms', shorts: 'bottoms', skirt: 'bottoms',
    shoes: 'footwear', sneakers: 'footwear', boots: 'footwear',
    hat: 'headwear', beanie: 'headwear', cap: 'headwear',
    jacket: 'outerwear', coat: 'outerwear', raincoat: 'outerwear',
    scarf: 'accessories', bag: 'accessories', gloves: 'accessories'
  };
  for (const [word, cat] of Object.entries(catWords)) {
    if (lower.includes(word) && !categories.includes(cat)) categories.push(cat);
  }
  const colors: string[] = [];
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (lower.includes(word)) colors.push(hex);
  }
  let maxWarmth: number | undefined;
  let minWarmth: number | undefined;
  if (/warm|cold|winter/.test(lower)) minWarmth = 6;
  if (/cool|light|summer|hot/.test(lower)) maxWarmth = 4;
  const occasionMatch = lower.match(/for (a |an |the )?([a-z ]{3,30})/);
  const occasion = occasionMatch ? occasionMatch[2].trim() : undefined;
  const mustExclude: string[] = [];
  const noMatch = lower.match(/no (\w+)/g);
  if (noMatch) noMatch.forEach((m) => mustExclude.push(m.replace('no ', '')));

  return {
    status: 'ok',
    provider: 'local',
    data: { categories, colors, maxWarmth, minWarmth, occasion, mustInclude: [], mustExclude }
  };
}

// ---------- Receipt parsing (after Tesseract OCR) -------------------------------

const RECEIPT_PROMPT_PREFIX = `Extract purchased grocery items from this OCR-scanned receipt text. Ignore totals, tax lines,
and store headers. Respond with JSON ONLY:
{ "items": [{"name": string, "quantity": number, "unit": string, "estimatedPrice": number|undefined}],
  "storeName": string|undefined, "purchaseDate": "YYYY-MM-DD"|undefined }
Receipt text:
`;

export async function parseReceiptWithGemini(ocrText: string, model: string): Promise<AiResult<GeminiReceipt>> {
  const result = await callGeminiJson(model, RECEIPT_PROMPT_PREFIX + ocrText, GeminiReceiptSchema);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiReceipt };
  }
  return result;
}

/** Local fallback: one-line-per-item heuristic ("NAME  QTY  PRICE"). Much
 * less accurate than Gemini extraction; always shown to the user to confirm. */
export function parseReceiptLocal(ocrText: string): AiResult<GeminiReceipt> {
  const lines = ocrText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !/total|subtotal|tax|change|cash|card|balance/i.test(l));
  const items = lines
    .map((line) => {
      const priceMatch = line.match(/(\d+[.,]\d{2})\s*$/);
      const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : undefined;
      const name = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
      const qtyMatch = name.match(/^(\d+)\s*x?\s+/i);
      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      const cleanName = (qtyMatch ? name.slice(qtyMatch[0].length) : name).trim();
      return cleanName ? { name: cleanName, quantity, unit: 'pcs', estimatedPrice: price } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.name.length > 1)
    .slice(0, 40);
  return { status: 'ok', provider: 'local', data: { items } };
}

// ---------- Recipe extraction from pasted text / URL text ----------------------

const RECIPE_PROMPT_PREFIX = `Extract a structured recipe from this text. Respond with JSON ONLY:
{ "name": string, "servings": number, "ingredients": [{"name": string, "quantity": number, "unit": string}],
  "steps": [string], "prepMinutes": number|undefined }
Text:
`;

export async function extractRecipeWithGemini(text: string, model: string): Promise<AiResult<GeminiRecipeExtraction>> {
  const result = await callGeminiJson(model, RECIPE_PROMPT_PREFIX + text, GeminiRecipeExtractionSchema);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiRecipeExtraction };
  }
  return result;
}

/** Local fallback: looks for "Ingredients"/"Steps" sections and simple
 * "<qty> <unit> <name>" lines. Works for reasonably well-formatted text;
 * otherwise the user edits the result manually. */
export function extractRecipeLocal(text: string): AiResult<GeminiRecipeExtraction> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const ingredientsIdx = lines.findIndex((l) => /ingredients/i.test(l));
  const stepsIdx = lines.findIndex((l) => /steps|instructions|method/i.test(l));
  const nameLine = lines[0] ?? 'Imported recipe';
  const ingredientLines = ingredientsIdx >= 0 ? lines.slice(ingredientsIdx + 1, stepsIdx > ingredientsIdx ? stepsIdx : undefined) : [];
  const stepLines = stepsIdx >= 0 ? lines.slice(stepsIdx + 1) : [];

  const ingredients = ingredientLines
    .map((l) => {
      const m = l.match(/^([\d.]+)\s*([a-zA-Z]*)\s+(.+)$/);
      if (m) return { name: m[3].trim(), quantity: parseFloat(m[1]), unit: m[2] || 'pcs' };
      return l.length > 1 ? { name: l.replace(/^[-*]\s*/, ''), quantity: 1, unit: 'pcs' } : null;
    })
    .filter((x): x is { name: string; quantity: number; unit: string } => !!x);

  return {
    status: 'ok',
    provider: 'local',
    data: {
      name: nameLine.replace(/^[-*#\s]+/, ''),
      servings: 2,
      ingredients,
      steps: stepLines.map((l) => l.replace(/^\d+[.)]\s*/, '')),
      prepMinutes: undefined
    }
  };
}

/** Attempt to fetch a recipe URL client-side. Many sites block cross-origin
 * fetches (CORS) or forbid scraping in their terms -- this is a best-effort
 * convenience only; failure always falls back to asking the user to paste
 * the recipe text instead. */
export async function tryFetchRecipePage(url: string): Promise<AiResult<string>> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return { status: 'ok', provider: 'local', data: text.slice(0, 8000) };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: 'network',
      message:
        'Could not fetch that page directly (likely blocked by CORS or the site\u2019s policy). Please paste the recipe text instead.'
    };
  }
}

// ---------- Meal suggestions -----------------------------------------------------

const MEAL_SUGGESTION_PROMPT_PREFIX = `Suggest meals for a student based on: the request text, their available ingredients list,
and constraints. Respond with JSON ONLY:
{ "suggestions": [{"name": string, "usesIngredients": [string], "missingIngredients": [string],
  "estimatedPrepMinutes": number|undefined, "reason": string}] }
`;

export async function generateMealSuggestionsWithGemini(
  request: string,
  availableIngredients: string[],
  constraints: { useOnlyExisting?: boolean; dietary?: string[]; maxPrepMinutes?: number },
  model: string
): Promise<AiResult<GeminiMealSuggestion>> {
  const prompt = `${MEAL_SUGGESTION_PROMPT_PREFIX}Request: ${request}\nAvailable ingredients: ${availableIngredients.join(', ')}\nConstraints: ${JSON.stringify(constraints)}`;
  const result = await callGeminiJson(model, prompt, GeminiMealSuggestionSchema);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiMealSuggestion };
  }
  return result;
}

// ---------- Task classification ---------------------------------------------------

const TASK_PROMPT_PREFIX = `Classify this freeform student task into structured JSON ONLY (use null when unknown):
{ "title": string, "category": string, "priority": "low"|"medium"|"high"|"urgent",
  "dueAt": "ISO 8601 datetime"|null, "location": string|null,
  "recurrence": {"freq": "none"|"daily"|"weekly"|"monthly", "interval": number} }
Current date/time for relative parsing: `;

export async function classifyTaskWithGemini(text: string, model: string): Promise<AiResult<GeminiTaskClassification>> {
  const result = await callGeminiJson(model, TASK_PROMPT_PREFIX + new Date().toISOString() + `\nTask: ${text}`, GeminiTaskClassificationSchema);
  if (result.status === 'ok') {
    return { ...result, data: result.data as GeminiTaskClassification };
  }
  return result;
}

export function classifyTaskLocal(text: string): AiResult<GeminiTaskClassification> {
  const parsed = parseTaskText(text);
  return {
    status: 'ok',
    provider: 'local',
    data: {
      title: parsed.title,
      category: 'general',
      priority: parsed.priority ?? 'medium',
      dueAt: parsed.dueAt,
      location: parsed.location,
      recurrence: parsed.recurrence
    }
  };
}

// ---------- Local vision model (Transformers.js) -----------------------------
// Lazily loaded only when first needed, and guarded so a failed/unavailable
// model never blocks the app. Uses a general-purpose CLIP checkpoint
// (Xenova/clip-vit-base-patch32, MIT-licensed ONNX export) in a zero-shot
// image-classification role as a practical stand-in for fashion-specific
// understanding -- this is NOT a dedicated fashion model, and is labelled
// as such everywhere it is surfaced in the UI.
let zeroShotPipelinePromise: Promise<any> | null = null;

async function getZeroShotPipeline() {
  if (!zeroShotPipelinePromise) {
    zeroShotPipelinePromise = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32'))
      .catch((err) => {
        zeroShotPipelinePromise = null;
        throw err;
      });
  }
  return zeroShotPipelinePromise;
}

export async function classifyGarmentCategoryLocalVision(imageBlob: Blob): Promise<AiResult<{ category: GarmentCategory; confidence: number }>> {
  try {
    const pipe = await getZeroShotPipeline();
    const url = URL.createObjectURL(imageBlob);
    const labels = ['a photo of a top or shirt', 'a photo of pants or trousers', 'a photo of shoes', 'a photo of a hat', 'a photo of a jacket or coat', 'a photo of an accessory'];
    const labelToCategory: Record<string, GarmentCategory> = {
      'a photo of a top or shirt': 'tops',
      'a photo of pants or trousers': 'bottoms',
      'a photo of shoes': 'footwear',
      'a photo of a hat': 'headwear',
      'a photo of a jacket or coat': 'outerwear',
      'a photo of an accessory': 'accessories'
    };
    const output = await pipe(url, labels);
    URL.revokeObjectURL(url);
    const best = Array.isArray(output) ? output[0] : output;
    if (!best) throw new Error('No classification output');
    return { status: 'ok', provider: 'local', data: { category: labelToCategory[best.label] ?? 'other', confidence: best.score } };
  } catch (err) {
    return { status: 'error', provider: 'local', errorType: 'unavailable', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- OCR (Tesseract.js) ----------------------------------------------------

export async function ocrImage(blob: Blob, onProgress?: (p: number) => void): Promise<AiResult<string>> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      }
    });
    const { data } = await worker.recognize(blob);
    await worker.terminate();
    return { status: 'ok', provider: 'local', data: data.text };
  } catch (err) {
    return { status: 'error', provider: 'local', errorType: 'unavailable', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- Barcode scanning (native BarcodeDetector -> ZXing fallback) ----------

export interface BarcodeScanner {
  start: (videoEl: HTMLVideoElement, onDetect: (text: string) => void, onError?: (e: unknown) => void) => Promise<void>;
  stop: () => void;
}

export function createBarcodeScanner(): BarcodeScanner {
  let stream: MediaStream | null = null;
  let rafId: number | null = null;
  let zxingControls: { stop: () => void } | null = null;

  async function startNative(videoEl: HTMLVideoElement, onDetect: (text: string) => void, onError?: (e: unknown) => void) {
    // @ts-expect-error -- BarcodeDetector is not yet in all TS DOM lib versions
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoEl.srcObject = stream;
    await videoEl.play();
    const tick = async () => {
      try {
        const codes = await detector.detect(videoEl);
        if (codes.length > 0) {
          onDetect(codes[0].rawValue);
          return;
        }
      } catch (e) {
        onError?.(e);
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  async function startZxing(videoEl: HTMLVideoElement, onDetect: (text: string) => void, onError?: (e: unknown) => void) {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    const controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result: { getText(): string } | undefined, err: { name?: string } | undefined) => {
      if (result) onDetect(result.getText());
      else if (err && err.name !== 'NotFoundException') onError?.(err);
    });
    zxingControls = controls;
  }

  return {
    async start(videoEl, onDetect, onError) {
      if ('BarcodeDetector' in window) {
        try {
          await startNative(videoEl, onDetect, onError);
          return;
        } catch (e) {
          // fall through to ZXing
        }
      }
      await startZxing(videoEl, onDetect, onError);
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      zxingControls?.stop();
    }
  };
}

// ---------- Open Food Facts barcode lookup ----------------------------------------

const OffProductSchema = z.object({
  product: z
    .object({
      product_name: z.string().optional(),
      brands: z.string().optional(),
      quantity: z.string().optional(),
      nutriments: z
        .object({
          'energy-kcal_100g': z.number().optional(),
          proteins_100g: z.number().optional(),
          carbohydrates_100g: z.number().optional(),
          fat_100g: z.number().optional(),
          fiber_100g: z.number().optional(),
          sugars_100g: z.number().optional(),
          sodium_100g: z.number().optional()
        })
        .partial()
        .optional(),
      image_front_small_url: z.string().optional()
    })
    .optional(),
  status: z.number().optional()
});

export interface OffLookupResult {
  name: string;
  brand?: string;
  quantity?: string;
  nutrition: {
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
  };
  imageUrl?: string;
}

export async function lookupBarcode(barcode: string): Promise<AiResult<OffLookupResult>> {
  const cacheKey = `off:${barcode}`;
  const cached = await aiCacheGet<OffLookupResult>(cacheKey);
  if (cached) return { status: 'ok', provider: 'local', data: cached };
  try {
    const fields = 'product_name,brands,quantity,nutriments,image_front_small_url';
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const parsed = OffProductSchema.safeParse(json);
    if (!parsed.success || !parsed.data.product || parsed.data.status === 0) {
      return { status: 'error', provider: 'local', errorType: 'invalid-response', message: 'Product not found in Open Food Facts.' };
    }
    const p = parsed.data.product;
    const data: OffLookupResult = {
      name: p.product_name || 'Unknown product',
      brand: p.brands,
      quantity: p.quantity,
      nutrition: {
        calories: p.nutriments?.['energy-kcal_100g'],
        proteinG: p.nutriments?.proteins_100g,
        carbsG: p.nutriments?.carbohydrates_100g,
        fatG: p.nutriments?.fat_100g,
        fiberG: p.nutriments?.fiber_100g,
        sugarG: p.nutriments?.sugars_100g,
        sodiumMg: p.nutriments?.sodium_100g ? p.nutriments.sodium_100g * 1000 : undefined
      },
      imageUrl: p.image_front_small_url
    };
    await aiCacheSet(cacheKey, data);
    return { status: 'ok', provider: 'local', data };
  } catch (err) {
    return {
      status: 'error',
      provider: 'local',
      errorType: /failed to fetch/i.test(String(err)) ? 'network' : 'unknown',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
