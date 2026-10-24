// ---------------------------------------------------------------------------
// Fridge area: Food, Meals and Shopping List tabs.
// ---------------------------------------------------------------------------
import React, { useMemo, useRef, useState } from 'react';
import {
  Apple, Plus, Search, Barcode, Receipt, Camera, Trash2, ChefHat, Sparkles, Cpu, Link as LinkIcon,
  ClipboardPaste, ShoppingCart, Check, AlertTriangle, PackageCheck, Loader2, X
} from 'lucide-react';
import { useApp } from '../context';
import {
  Button, IconButton, Card, Badge, AiSourceBadge, StarRating, BlobImage, EmptyState, Sheet,
  Field, TextInput, TextArea, Select, Toggle, TabBar, SectionHeader, PhotoInput, useConfirm, Spinner, NumberStepper
} from '../components';
import { FOOD_STORAGE_LABELS } from '../data';
import type { FoodItem, Recipe, ShoppingItem, Ingredient, MealPlan } from '../types';
import { newId, nowIso } from '../types';
import { formatDate, daysUntil, resizeImage } from '../lib';
import { expiryRisk, isSafeToConsume, evaluateRecipeAvailability, rankRecipeSuggestions, getExpiringFoodItems } from '../services';
import {
  lookupBarcode, createBarcodeScanner, ocrImage, parseReceiptWithGemini, parseReceiptLocal, extractRecipeWithGemini,
  extractRecipeLocal, tryFetchRecipePage, generateMealSuggestionsWithGemini, isGeminiConfigured
} from '../ai';
import type { GeminiReceiptItem } from '../types';

type FridgeTab = 'food' | 'meals' | 'shopping';

export default function Fridge() {
  const [tab, setTab] = useState<FridgeTab>('food');
  return (
    <div className="pb-28">
      <TabBar tabs={[{ key: 'food', label: 'Food' }, { key: 'meals', label: 'Meals' }, { key: 'shopping', label: 'Shopping List' }]} active={tab} onChange={setTab} />
      {tab === 'food' && <FoodTab />}
      {tab === 'meals' && <MealsTab />}
      {tab === 'shopping' && <ShoppingTab />}
    </div>
  );
}

const RISK_BADGE: Record<string, { tone: 'rose' | 'amber' | 'green' | 'slate'; label: string }> = {
  expired: { tone: 'rose', label: 'Expired' },
  soon: { tone: 'amber', label: 'Expiring soon' },
  ok: { tone: 'green', label: 'Fresh' },
  unknown: { tone: 'slate', label: 'No date' }
};

// =============================== FOOD =========================================

function FoodTab() {
  const { foodItems, deleteFoodItem } = useApp();
  const [query, setQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<'all' | FoodItem['storageLocation']>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<FoodItem | null>(null);

  const filtered = useMemo(() => {
    return foodItems
      .filter((f) => (locationFilter === 'all' || f.storageLocation === locationFilter) && f.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (daysUntil(a.expirationDate) ?? 9999) - (daysUntil(b.expirationDate) ?? 9999));
  }, [foodItems, query, locationFilter]);

  const expiringSoon = getExpiringFoodItems(foodItems, 2);

  return (
    <div className="px-4">
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search food…" className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        {(['all', 'fridge', 'freezer', 'cupboard'] as const).map((loc) => (
          <button key={loc} onClick={() => setLocationFilter(loc)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border ${locationFilter === loc ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
            {loc === 'all' ? 'All' : FOOD_STORAGE_LABELS[loc]}
          </button>
        ))}
      </div>

      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 text-amber-800 text-xs rounded-xl p-3 mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{expiringSoon.length} item(s) expiring within 2 days: {expiringSoon.map((f) => f.name).join(', ')}.</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={<Apple size={24} />} title="No food items" description="Add items manually, by barcode, or from a receipt photo." action={<Button onClick={() => setAddOpen(true)}><Plus size={16} /> Add food</Button>} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((f) => {
            const risk = expiryRisk(f);
            return (
              <Card key={f.id} onClick={() => setSelected(f)} className="overflow-hidden">
                <div className="relative aspect-square">
                  <BlobImage blobKey={f.image?.blobKey} alt={f.name} className="w-full h-full" />
                  <span className="absolute top-1.5 left-1.5"><Badge tone={RISK_BADGE[risk].tone}>{RISK_BADGE[risk].label}</Badge></span>
                </div>
                <div className="p-2.5">
                  <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                  <p className="text-xs text-slate-400">{f.quantity} {f.unit} · {FOOD_STORAGE_LABELS[f.storageLocation]}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-20">
        <Button size="lg" ariaLabel="Add food" className="rounded-full shadow-lg h-14 w-14 !px-0" onClick={() => setAddOpen(true)}><Plus size={24} /></Button>
      </div>

      {addOpen && <AddFoodSheet onClose={() => setAddOpen(false)} />}
      {selected && <FoodDetailSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AddFoodSheet({ onClose }: { onClose: () => void }) {
  const { addFoodItem, saveImage, pushToast, settings } = useApp();
  const [mode, setMode] = useState<'manual' | 'barcode' | 'receipt'>('manual');
  const [form, setForm] = useState<Partial<FoodItem>>({ name: '', quantity: 1, unit: 'pcs', storageLocation: 'fridge', dateCertainty: 'unknown' });
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  async function save(extra?: Partial<FoodItem>) {
    const merged = { ...form, ...extra };
    if (!merged.name) {
      pushToast('Enter a name before saving', 'error');
      return;
    }
    let image;
    if (photoBlob) image = await saveImage(photoBlob, 'display');
    const item: FoodItem = {
      id: newId(), name: merged.name!, image: image as any, expirationDate: merged.expirationDate ?? null,
      dateCertainty: merged.dateCertainty ?? 'unknown', purchaseDate: merged.purchaseDate ?? nowIso(),
      quantity: merged.quantity ?? 1, unit: merged.unit ?? 'pcs', estimatedRemainingFraction: 1,
      nutrition: merged.nutrition, description: merged.description, storageLocation: merged.storageLocation ?? 'fridge',
      barcode: merged.barcode, source: merged.source ?? 'manual', userCorrected: false, createdAt: nowIso(), updatedAt: nowIso()
    };
    await addFoodItem(item);
    pushToast('Food item added', 'success');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Add food" wide footer={mode === 'manual' ? <Button onClick={() => save()} disabled={!form.name}>Save</Button> : undefined}>
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={mode === 'manual' ? 'primary' : 'outline'} onClick={() => setMode('manual')}>Manual</Button>
        <Button size="sm" variant={mode === 'barcode' ? 'primary' : 'outline'} onClick={() => setMode('barcode')}><Barcode size={14} /> Barcode</Button>
        <Button size="sm" variant={mode === 'receipt' ? 'primary' : 'outline'} onClick={() => setMode('receipt')}><Receipt size={14} /> Receipt</Button>
      </div>

      {mode === 'manual' && (
        <div>
          <div className="flex gap-3 mb-3">
            <div className="h-20 w-20 rounded-xl overflow-hidden bg-slate-100 shrink-0">{photoBlob && <img src={URL.createObjectURL(photoBlob)} className="w-full h-full object-cover" alt="" />}</div>
            <PhotoInput label="Add photo (optional)" onFile={async (f) => setPhotoBlob((await resizeImage(f, 800)).blob)} capture={false} />
          </div>
          <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Milk" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity"><TextInput type="number" min={0} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} /></Field>
            <Field label="Unit"><TextInput value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="pcs, g, L…" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Storage">
              <Select value={form.storageLocation} onChange={(e) => setForm((f) => ({ ...f, storageLocation: e.target.value as any }))}>
                {Object.entries(FOOD_STORAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Date type">
              <Select value={form.dateCertainty} onChange={(e) => setForm((f) => ({ ...f, dateCertainty: e.target.value as any }))}>
                <option value="unknown">Unknown</option><option value="best-before">Best before</option><option value="use-by">Use by</option>
              </Select>
            </Field>
          </div>
          <Field label="Expiration date" hint="Leave blank if unknown — not every photo or label gives a reliable date.">
            <TextInput type="date" value={form.expirationDate?.slice(0, 10) ?? ''} onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
          </Field>
        </div>
      )}

      {mode === 'barcode' && <BarcodeCapture onResolved={(data) => { setForm((f) => ({ ...f, ...data, source: 'barcode' })); setMode('manual'); }} />}
      {mode === 'receipt' && <ReceiptCapture onItems={async (items) => { for (const it of items) { await addFoodItem({ id: newId(), name: it.name, expirationDate: null, dateCertainty: 'unknown', purchaseDate: nowIso(), quantity: it.quantity, unit: it.unit, estimatedRemainingFraction: 1, storageLocation: 'cupboard', source: 'receipt', userCorrected: false, createdAt: nowIso(), updatedAt: nowIso() }); } pushToast(`${items.length} item(s) added from receipt`, 'success'); onClose(); }} />}
    </Sheet>
  );
}

function BarcodeCapture({ onResolved }: { onResolved: (data: Partial<FoodItem>) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const scannerRef = useRef(createBarcodeScanner());

  async function startScan() {
    setScanning(true);
    setStatus(null);
    try {
      await scannerRef.current.start(videoRef.current!, async (code) => {
        scannerRef.current.stop();
        setScanning(false);
        await resolveCode(code);
      }, () => {});
    } catch (err) {
      setScanning(false);
      setStatus('Camera unavailable. Enter the barcode number manually below.');
    }
  }

  async function resolveCode(code: string) {
    setStatus('Looking up product…');
    const result = await lookupBarcode(code);
    if (result.status === 'ok') {
      onResolved({ name: result.data.name, barcode: code, nutrition: { calories: result.data.nutrition.calories, proteinG: result.data.nutrition.proteinG, carbsG: result.data.nutrition.carbsG, fatG: result.data.nutrition.fatG, fiberG: result.data.nutrition.fiberG, sugarG: result.data.nutrition.sugarG, sodiumMg: result.data.nutrition.sodiumMg } });
    } else {
      setStatus(`${result.message} You can still enter the item manually.`);
      onResolved({ barcode: code });
    }
  }

  return (
    <div className="text-center">
      {scanning ? (
        <video ref={videoRef} className="w-full rounded-xl mb-3 bg-black aspect-video object-cover" muted playsInline />
      ) : (
        <Button onClick={startScan} className="mb-3"><Camera size={16} /> Start camera scan</Button>
      )}
      {status && <p className="text-xs text-slate-500 mb-3">{status}</p>}
      <p className="text-xs text-slate-400 mb-2">Product lookup uses the free Open Food Facts database.</p>
      <div className="flex gap-2">
        <TextInput value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Or type barcode number" />
        <Button variant="outline" onClick={() => manualCode && resolveCode(manualCode)}>Look up</Button>
      </div>
    </div>
  );
}

function ReceiptCapture({ onItems }: { onItems: (items: GeminiReceiptItem[]) => void }) {
  const { settings, pushToast } = useApp();
  const [status, setStatus] = useState<'idle' | 'ocr' | 'parsing' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [items, setItems] = useState<GeminiReceiptItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function handleFile(file: File) {
    setStatus('ocr');
    const resized = await resizeImage(file, 1600);
    const ocr = await ocrImage(resized.blob, setProgress);
    if (ocr.status !== 'ok') {
      pushToast(`OCR failed: ${ocr.message}`, 'error');
      setStatus('idle');
      return;
    }
    setStatus('parsing');
    const firstPass = isGeminiConfigured()
      ? await parseReceiptWithGemini(ocr.data, settings.geminiModels.textModel)
      : parseReceiptLocal(ocr.data);
    // parseReceiptLocal is a deterministic heuristic that never reports an error,
    // so this fallback always yields a usable (if less accurate) result.
    const parsed = firstPass.status === 'ok' ? firstPass : parseReceiptLocal(ocr.data);
    const finalItems = parsed.status === 'ok' ? parsed.data.items : [];
    setItems(finalItems);
    setSelected(new Set(finalItems.map((_, i) => i)));
    setStatus('done');
  }

  return (
    <div>
      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Receipt size={28} className="text-indigo-400" />
          <p className="text-sm text-slate-500 text-center max-w-xs">Photograph a receipt. Text is extracted on-device with OCR, then parsed into items for you to confirm.</p>
          <PhotoInput label="Choose receipt photo" onFile={handleFile} capture={false} />
        </div>
      )}
      {(status === 'ocr' || status === 'parsing') && (
        <div className="flex flex-col items-center gap-2 py-6 text-slate-500 text-sm">
          <Spinner size={20} />
          <p>{status === 'ocr' ? `Reading text… ${Math.round(progress * 100)}%` : 'Extracting items…'}</p>
        </div>
      )}
      {status === 'done' && (
        <div>
          <p className="text-xs text-slate-400 mb-2">Confirm the items found — OCR and parsing can make mistakes.</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto mb-3">
            {items.map((it, i) => (
              <label key={i} className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-2.5 py-2">
                <input type="checkbox" checked={selected.has(i)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                <input className="flex-1 text-sm outline-none" value={it.name} onChange={(e) => setItems((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                <span className="text-slate-400 text-xs">{it.quantity} {it.unit}</span>
              </label>
            ))}
            {items.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No items detected — try a clearer photo or add items manually.</p>}
          </div>
          <Button onClick={() => onItems(items.filter((_, i) => selected.has(i)))} disabled={selected.size === 0}>Add {selected.size} item(s) to inventory</Button>
        </div>
      )}
    </div>
  );
}

function FoodDetailSheet({ item, onClose }: { item: FoodItem; onClose: () => void }) {
  const { updateFoodItem, deleteFoodItem, pushToast } = useApp();
  const [form, setForm] = useState(item);
  const confirm = useConfirm();
  const safe = isSafeToConsume(form);

  return (
    <Sheet open onClose={onClose} title={item.name} footer={<>
      <Button variant="danger" onClick={async () => { if (await confirm.ask('Remove this food item?', 'Delete item?')) { await deleteFoodItem(item.id); onClose(); } }}><Trash2 size={15} /></Button>
      <Button onClick={async () => { await updateFoodItem(item.id, { ...form, userCorrected: true, updatedAt: nowIso() }); pushToast('Updated', 'success'); onClose(); }}>Save</Button>
    </>}>
      {confirm.node}
      {!safe && (
        <div className="bg-rose-50 text-rose-700 text-xs rounded-lg p-2.5 mb-3 flex items-center gap-2"><AlertTriangle size={14} /> Past its use-by date — do not assume it is safe to eat.</div>
      )}
      <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity"><TextInput type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))} /></Field>
        <Field label="Unit"><TextInput value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} /></Field>
      </div>
      <Field label={`Remaining: ${Math.round(form.estimatedRemainingFraction * 100)}%`}>
        <input type="range" min={0} max={1} step={0.05} value={form.estimatedRemainingFraction} onChange={(e) => setForm((f) => ({ ...f, estimatedRemainingFraction: Number(e.target.value) }))} className="w-full" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Storage">
          <Select value={form.storageLocation} onChange={(e) => setForm((f) => ({ ...f, storageLocation: e.target.value as any }))}>
            {Object.entries(FOOD_STORAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Date type">
          <Select value={form.dateCertainty} onChange={(e) => setForm((f) => ({ ...f, dateCertainty: e.target.value as any }))}>
            <option value="unknown">Unknown</option><option value="best-before">Best before</option><option value="use-by">Use by</option>
          </Select>
        </Field>
      </div>
      <Field label="Expiration date">
        <TextInput type="date" value={form.expirationDate?.slice(0, 10) ?? ''} onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
      </Field>
      {form.nutrition && (
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 grid grid-cols-2 gap-1">
          {form.nutrition.calories !== undefined && <span>Calories: {form.nutrition.calories}/100g</span>}
          {form.nutrition.proteinG !== undefined && <span>Protein: {form.nutrition.proteinG}g</span>}
          {form.nutrition.carbsG !== undefined && <span>Carbs: {form.nutrition.carbsG}g</span>}
          {form.nutrition.fatG !== undefined && <span>Fat: {form.nutrition.fatG}g</span>}
        </div>
      )}
    </Sheet>
  );
}

// =============================== MEALS =========================================

function MealsTab() {
  const { recipes, foodItems } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selected, setSelected] = useState<Recipe | null>(null);

  const ranked = useMemo(() => rankRecipeSuggestions(recipes, foodItems), [recipes, foodItems]);

  return (
    <div className="px-4 pb-24">
      <div className="flex gap-2 mb-3">
        <Button className="flex-1" variant="outline" onClick={() => setAddOpen(true)}><Plus size={16} /> Add recipe</Button>
        <Button className="flex-1" onClick={() => setGenerateOpen(true)}><Sparkles size={16} /> Suggest a meal</Button>
      </div>

      {ranked.length === 0 ? (
        <EmptyState icon={<ChefHat size={24} />} title="No meals saved" description="Add a recipe manually, paste one, or import from a URL." />
      ) : (
        <div className="space-y-3">
          {ranked.map(({ recipe, overall, perIngredient, score }) => (
            <Card key={recipe.id} onClick={() => setSelected(recipe)} className="p-3 flex gap-3">
              <div className="h-16 w-16 rounded-lg overflow-hidden shrink-0"><BlobImage blobKey={recipe.image?.blobKey} alt={recipe.name} className="w-full h-full" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{recipe.name}</p>
                <p className="text-xs text-slate-400">{recipe.servings} servings · {recipe.prepMinutes ?? '?'} min</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge tone={overall === 'green' ? 'green' : overall === 'amber' ? 'amber' : 'rose'}>
                    {overall === 'green' ? 'Ready to cook' : overall === 'amber' ? 'Low on some items' : 'Missing ingredients'}
                  </Badge>
                  <span className="text-[11px] text-slate-400">match score {score}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {addOpen && <AddRecipeSheet onClose={() => setAddOpen(false)} />}
      {generateOpen && <SuggestMealSheet onClose={() => setGenerateOpen(false)} />}
      {selected && <RecipeDetailSheet recipe={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AddRecipeSheet({ onClose }: { onClose: () => void }) {
  const { addRecipe, settings, pushToast } = useApp();
  const [mode, setMode] = useState<'manual' | 'paste' | 'url'>('manual');
  const [name, setName] = useState('');
  const [servings, setServings] = useState(2);
  const [ingredients, setIngredients] = useState<{ name: string; quantity: number; unit: string }[]>([{ name: '', quantity: 1, unit: 'pcs' }]);
  const [steps, setSteps] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'local' | 'gemini' | null>(null);

  async function saveManual() {
    if (!name) { pushToast('Enter a recipe name', 'error'); return; }
    const recipe: Recipe = {
      id: newId(), name, servings, ingredients: ingredients.filter((i) => i.name).map((i) => ({ id: newId(), ...i, substitutes: [] })),
      steps: steps.split('\n').filter(Boolean), lastMadeAt: null, recurrence: { freq: 'none', interval: 1 }, remainingServings: 0,
      tags: [], createdAt: nowIso(), updatedAt: nowIso()
    };
    await addRecipe(recipe);
    pushToast('Recipe saved', 'success');
    onClose();
  }

  async function extractFromText(text: string) {
    setLoading(true);
    const firstPass = isGeminiConfigured()
      ? await extractRecipeWithGemini(text, settings.geminiModels.textModel)
      : extractRecipeLocal(text);
    // extractRecipeLocal is a deterministic heuristic that never reports an error.
    const result = firstPass.status === 'ok' ? firstPass : extractRecipeLocal(text);
    setProvider(result.provider === 'gemini' ? 'gemini' : 'local');
    const data = result.status === 'ok' ? result.data : { name: '', servings: 2, ingredients: [], steps: [] };
    setName(data.name);
    setServings(data.servings);
    setIngredients(data.ingredients.length ? data.ingredients : [{ name: '', quantity: 1, unit: 'pcs' }]);
    setSteps(data.steps.join('\n'));
    setLoading(false);
    setMode('manual');
  }

  async function handleUrl() {
    setLoading(true);
    const page = await tryFetchRecipePage(url);
    setLoading(false);
    if (page.status !== 'ok') {
      pushToast(page.message, 'error');
      return;
    }
    await extractFromText(page.data);
  }

  return (
    <Sheet open onClose={onClose} title="Add recipe" wide footer={mode === 'manual' ? <Button onClick={saveManual} disabled={!name}>Save recipe</Button> : undefined}>
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={mode === 'manual' ? 'primary' : 'outline'} onClick={() => setMode('manual')}>Manual</Button>
        <Button size="sm" variant={mode === 'paste' ? 'primary' : 'outline'} onClick={() => setMode('paste')}><ClipboardPaste size={14} /> Paste text</Button>
        <Button size="sm" variant={mode === 'url' ? 'primary' : 'outline'} onClick={() => setMode('url')}><LinkIcon size={14} /> From URL</Button>
      </div>

      {mode === 'paste' && (
        <div>
          <TextArea rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a full recipe (ingredients + steps)…" className="mb-3" />
          <Button onClick={() => extractFromText(pasteText)} disabled={!pasteText || loading}>{loading ? <Spinner size={16} /> : <Sparkles size={16} />} Extract recipe</Button>
        </div>
      )}
      {mode === 'url' && (
        <div>
          <Field label="Recipe URL" hint="Many sites block automated fetching (CORS/terms of service) — if this fails, paste the text instead.">
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Button onClick={handleUrl} disabled={!url || loading}>{loading ? <Spinner size={16} /> : <LinkIcon size={16} />} Fetch & extract</Button>
        </div>
      )}
      {mode === 'manual' && (
        <div>
          {provider && <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">{provider === 'gemini' ? <Sparkles size={12} /> : <Cpu size={12} />} Extracted {provider === 'gemini' ? 'with Gemini' : 'locally'} — please review.</p>}
          <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Servings"><NumberStepper value={servings} onChange={setServings} min={1} /></Field>
          <p className="text-sm font-medium text-slate-700 mb-2">Ingredients</p>
          {ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <TextInput className="flex-1" value={ing.name} onChange={(e) => setIngredients((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} placeholder="Ingredient" />
              <TextInput className="w-16" type="number" value={ing.quantity} onChange={(e) => setIngredients((arr) => arr.map((x, idx) => idx === i ? { ...x, quantity: Number(e.target.value) } : x))} />
              <TextInput className="w-16" value={ing.unit} onChange={(e) => setIngredients((arr) => arr.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))} placeholder="unit" />
              <IconButton icon={<X size={14} />} label="Remove" onClick={() => setIngredients((arr) => arr.filter((_, idx) => idx !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setIngredients((arr) => [...arr, { name: '', quantity: 1, unit: 'pcs' }])}>+ Add ingredient</Button>
          <Field label="Steps (one per line)"><TextArea rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} /></Field>
        </div>
      )}
    </Sheet>
  );
}

function RecipeDetailSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { foodItems, deleteRecipe, prepareMeal, addMealPlan, pushToast, runShoppingReconciliation } = useApp();
  const confirm = useConfirm();
  const [servingsMade, setServingsMade] = useState(recipe.servings);
  const availability = evaluateRecipeAvailability(recipe, foodItems);

  return (
    <Sheet open onClose={onClose} title={recipe.name} wide footer={<>
      <Button variant="danger" onClick={async () => { if (await confirm.ask('Delete this recipe?', 'Delete recipe?')) { await deleteRecipe(recipe.id); onClose(); } }}><Trash2 size={15} /></Button>
      <Button variant="outline" onClick={async () => { await addMealPlan({ id: newId(), recipeId: recipe.id, scheduledFor: nowIso(), servingsPlanned: recipe.servings, status: 'planned', createdAt: nowIso() }); await runShoppingReconciliation([recipe.id]); pushToast('Scheduled — shopping list updated for any missing ingredients', 'success'); }}>Schedule meal</Button>
      <Button onClick={async () => { await prepareMeal(recipe.id, servingsMade); pushToast('Meal prepared — inventory updated', 'success'); onClose(); }}>Mark prepared</Button>
    </>}>
      {confirm.node}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge tone={availability.overall === 'green' ? 'green' : availability.overall === 'amber' ? 'amber' : 'rose'}>{availability.overall === 'green' ? 'All ingredients available' : availability.overall === 'amber' ? 'Some low/uncertain' : 'Missing ingredients'}</Badge>
        <Badge tone="slate">Remaining servings: {recipe.remainingServings}</Badge>
      </div>
      <p className="text-sm font-medium text-slate-700 mb-2">Ingredients</p>
      <div className="space-y-1.5 mb-4">
        {recipe.ingredients.map((ing) => (
          <div key={ing.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-2">
            <span>{ing.name} — {ing.quantity} {ing.unit}</span>
            <Badge tone={availability.perIngredient[ing.id] === 'green' ? 'green' : availability.perIngredient[ing.id] === 'amber' ? 'amber' : 'rose'}>{availability.perIngredient[ing.id]}</Badge>
          </div>
        ))}
      </div>
      {recipe.steps.length > 0 && (
        <>
          <p className="text-sm font-medium text-slate-700 mb-2">Steps</p>
          <ol className="list-decimal list-inside text-sm text-slate-600 space-y-1 mb-4">{recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}
      <Field label="Servings made"><NumberStepper value={servingsMade} onChange={setServingsMade} min={1} /></Field>
      <p className="text-xs text-slate-400">Marking as prepared deducts matching ingredients from your Food inventory.</p>
    </Sheet>
  );
}

function SuggestMealSheet({ onClose }: { onClose: () => void }) {
  const { recipes, foodItems, settings, preferences, addRecipe, pushToast } = useApp();
  const [request, setRequest] = useState('');
  const [useExisting, setUseExisting] = useState(true);
  const [maxPrep, setMaxPrep] = useState(30);
  const [loading, setLoading] = useState(false);
  const [geminiSuggestions, setGeminiSuggestions] = useState<{ name: string; usesIngredients: string[]; missingIngredients: string[]; reason: string }[] | null>(null);
  const localRanked = useMemo(() => rankRecipeSuggestions(recipes, foodItems), [recipes, foodItems]);

  async function run() {
    if (!isGeminiConfigured()) {
      pushToast('No Gemini key configured — showing your best-matching saved recipes instead of generating new ones.', 'info');
      return;
    }
    setLoading(true);
    const result = await generateMealSuggestionsWithGemini(
      request || 'Any meal that fits my inventory',
      foodItems.map((f) => f.name),
      { useOnlyExisting: useExisting, dietary: preferences.dietaryPreferences, maxPrepMinutes: maxPrep },
      settings.geminiModels.textModel
    );
    setLoading(false);
    if (result.status === 'ok') setGeminiSuggestions(result.data.suggestions);
    else pushToast(`Gemini suggestion failed (${result.errorType}): showing saved recipes instead.`, 'error');
  }

  return (
    <Sheet open onClose={onClose} title="Suggest a meal" wide>
      <Field label="What are you in the mood for?"><TextInput value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. something quick and vegetarian" /></Field>
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-sm text-slate-600"><Toggle checked={useExisting} onChange={setUseExisting} /> Use only ingredients I have</label>
        <Field label={`Max ${maxPrep} min`}><input type="range" min={5} max={90} step={5} value={maxPrep} onChange={(e) => setMaxPrep(Number(e.target.value))} /></Field>
      </div>
      <Button onClick={run} disabled={loading} className="w-full mb-4">{loading ? <Spinner size={16} /> : <Sparkles size={16} />} Generate with Gemini</Button>

      {geminiSuggestions && (
        <div className="space-y-2 mb-4">
          <p className="text-xs text-slate-400 flex items-center gap-1"><Sparkles size={12} /> Gemini-generated ideas — ingredient availability shown is as reported by the model.</p>
          {geminiSuggestions.map((s, i) => (
            <Card key={i} className="p-3">
              <p className="font-medium text-sm">{s.name}</p>
              <p className="text-xs text-slate-500 mt-1">{s.reason}</p>
              {s.missingIngredients.length > 0 && <p className="text-xs text-amber-600 mt-1">Missing: {s.missingIngredients.join(', ')}</p>}
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 mb-2">Your saved recipes ranked by availability (always computed locally):</p>
      <div className="space-y-2">
        {localRanked.slice(0, 5).map(({ recipe, overall, score }) => (
          <Card key={recipe.id} className="p-3 flex items-center justify-between">
            <span className="text-sm font-medium">{recipe.name}</span>
            <Badge tone={overall === 'green' ? 'green' : overall === 'amber' ? 'amber' : 'rose'}>score {score}</Badge>
          </Card>
        ))}
      </div>
    </Sheet>
  );
}

// =============================== SHOPPING LIST =========================================

function ShoppingTab() {
  const { shoppingItems, recipes, foodItems, updateShoppingItem, deleteShoppingItem, addShoppingItem, addFoodFromShoppingItem, runShoppingReconciliation, pushToast } = useApp();
  const [newName, setNewName] = useState('');
  const confirm = useConfirm();

  const expiredNeedingReview = foodItems.filter((f) => expiryRisk(f) === 'expired');
  const pending = shoppingItems.filter((i) => !i.purchased);
  const purchased = shoppingItems.filter((i) => i.purchased);

  async function addManual() {
    if (!newName.trim()) return;
    await addShoppingItem({ id: newId(), name: newName.trim(), quantity: 1, unit: 'pcs', purchased: false, reason: 'manual', priceSource: 'unknown', createdAt: nowIso(), updatedAt: nowIso() });
    setNewName('');
  }

  return (
    <div className="px-4 pb-10">
      {confirm.node}
      <div className="flex gap-2 mb-3">
        <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add an item…" onKeyDown={(e) => e.key === 'Enter' && addManual()} />
        <Button onClick={addManual}><Plus size={16} /></Button>
      </div>
      <Button variant="outline" size="sm" className="mb-4" onClick={async () => { await runShoppingReconciliation(recipes.map((r) => r.id)); pushToast('Shopping list synced with meals & low-stock items', 'success'); }}>
        Sync with meals & inventory
      </Button>

      {expiredNeedingReview.length > 0 && (
        <div className="bg-rose-50 text-rose-700 text-xs rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{expiredNeedingReview.length} expired item(s) need review/disposal: {expiredNeedingReview.map((f) => f.name).join(', ')}. Not automatically treated as safe or unsafe.</span>
        </div>
      )}

      <SectionHeader title={`To buy (${pending.length})`} />
      {pending.length === 0 ? (
        <p className="text-sm text-slate-400 px-1 py-4">Nothing on your list right now.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((item) => (
            <Card key={item.id} className="p-3 flex items-center gap-3">
              <button onClick={() => updateShoppingItem(item.id, { purchased: true })} className="h-6 w-6 rounded-full border-2 border-slate-300 flex items-center justify-center shrink-0"><Check size={14} className="text-transparent hover:text-slate-400" /></button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-slate-400">{item.quantity} {item.unit}</span>
                  <Badge tone={item.reason === 'recipe' ? 'indigo' : item.reason === 'low-stock' ? 'amber' : item.reason === 'expired-replace' ? 'rose' : 'slate'}>{item.reason.replace('-', ' ')}</Badge>
                  {item.priceSource === 'unknown' ? <span className="text-[11px] text-slate-400">price unknown</span> : <span className="text-[11px] text-slate-500">~${item.estimatedPrice}</span>}
                </div>
              </div>
              <IconButton icon={<Trash2 size={14} />} label="Remove" onClick={async () => { if (await confirm.ask(`Remove "${item.name}" from the list?`)) await deleteShoppingItem(item.id); }} />
            </Card>
          ))}
        </div>
      )}

      {purchased.length > 0 && (
        <>
          <SectionHeader title={`Purchased (${purchased.length})`} />
          <div className="space-y-2">
            {purchased.map((item) => (
              <Card key={item.id} className="p-3 flex items-center gap-3 opacity-80">
                <Check size={18} className="text-emerald-500 shrink-0" />
                <span className="flex-1 text-sm line-through text-slate-500">{item.name}</span>
                <Button size="sm" variant="ghost" onClick={async () => { await addFoodFromShoppingItem(item.id); pushToast('Added to Fridge inventory', 'success'); }}><PackageCheck size={13} /> Add to Fridge</Button>
                <IconButton icon={<Trash2 size={14} />} label="Remove" onClick={() => deleteShoppingItem(item.id)} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
