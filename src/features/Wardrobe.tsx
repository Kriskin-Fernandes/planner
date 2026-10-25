// ---------------------------------------------------------------------------
// Wardrobe area: Clothes, Outfits (default) and Laundry tabs.
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import {
  Shirt, Plus, Search, SlidersHorizontal, Star, Heart, Sparkles, Cpu, Camera, Image as ImageIcon,
  Trash2, Wand2, Thermometer, Droplets, X, Shuffle, WashingMachine, AlertTriangle, CheckCircle2, User as UserIcon
} from 'lucide-react';
import { useApp } from '../context';
import {
  Button, IconButton, Card, Badge, AiSourceBadge, DemoBadge, StarRating, BlobImage, EmptyState, Sheet,
  Field, TextInput, TextArea, Select, Toggle, TabBar, SectionHeader, PhotoInput, useConfirm, Spinner
} from '../components';
import { GARMENT_CATEGORIES, GARMENT_CATEGORY_LABELS, LAYER_ROLE_LABELS, LAUNDRY_STATUS_LABELS } from '../data';
import type { Garment, GarmentCategory, Outfit, OutfitLayer, LaundryGroup } from '../types';
import { newId, nowIso } from '../types';
import { formatDate, formatRelative, resizeImage, dominantColorPalette } from '../lib';
import {
  evaluateOutfitCandidate, recommendOutfits, garmentAvailability, garmentsForLayers, findCareConflicts,
  recommendWashSettings, scoreOutfit, varyColorHarmony
} from '../services';
import {
  analyzeGarmentImage, analyzeGarmentImageLocal, classifyGarmentCategoryLocalVision, isGeminiConfigured,
  parseOutfitRequest, parseOutfitRequestLocal, type AiResult
} from '../ai';
import type { GeminiGarmentAnalysis, GeminiOutfitRequest } from '../types';

type WardrobeTab = 'outfits' | 'clothes' | 'laundry';

export default function Wardrobe() {
  const [tab, setTab] = useState<WardrobeTab>('outfits');
  return (
    <div className="pb-28">
      <TabBar
        tabs={[
          { key: 'outfits', label: 'Outfits' },
          { key: 'clothes', label: 'Clothes' },
          { key: 'laundry', label: 'Laundry' }
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'outfits' && <OutfitsTab />}
      {tab === 'clothes' && <ClothesTab />}
      {tab === 'laundry' && <LaundryTab />}
    </div>
  );
}

// =============================== CLOTHES =========================================

const EMPTY_FEATURES = { hood: false, waterproof: false, insulated: false, moistureWicking: false };
const EMPTY_CARE = { machineWashable: true, noTumbleDry: false, handWashOnly: false, noBleach: true, dryCleanOnly: false, maxWashTempC: 40 };

function ClothesTab() {
  const { garments } = useApp();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<GarmentCategory | 'all'>('all');
  const [sort, setSort] = useState<'name' | 'recent' | 'rating'>('recent');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Garment | null>(null);

  const filtered = useMemo(() => {
    let list = garments.filter((g) => (categoryFilter === 'all' || g.category === categoryFilter) && g.name.toLowerCase().includes(query.toLowerCase()));
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'rating') list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === 'recent') list = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return list;
  }, [garments, query, categoryFilter, sort]);

  return (
    <div className="px-4">
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clothes…"
            className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-3">
        <FilterChip active={categoryFilter === 'all'} label="All" onClick={() => setCategoryFilter('all')} />
        {GARMENT_CATEGORIES.map((c) => (
          <FilterChip key={c} active={categoryFilter === c} label={GARMENT_CATEGORY_LABELS[c]} onClick={() => setCategoryFilter(c)} />
        ))}
      </div>
      <div className="flex justify-end mb-3">
        <Select value={sort} onChange={(e) => setSort(e.target.value as any)} className="!w-auto text-xs py-1.5">
          <option value="recent">Recently updated</option>
          <option value="name">Name</option>
          <option value="rating">Rating</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Shirt size={24} />}
          title="No clothes yet"
          description="Add your first garment by taking a photo, uploading one, or importing a full outfit photo."
          action={<Button onClick={() => setAddOpen(true)}><Plus size={16} /> Add garment</Button>}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((g) => (
            <Card key={g.id} onClick={() => setSelected(g)} className="overflow-hidden">
              <div className="relative aspect-square">
                <BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full" />
                {g.laundryStatus !== 'clean' && (
                  <span className="absolute top-1.5 left-1.5">
                    <Badge tone={g.laundryStatus === 'needs-wash' ? 'rose' : 'amber'}>{LAUNDRY_STATUS_LABELS[g.laundryStatus]}</Badge>
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium text-slate-800 truncate">{g.name}</p>
                <div className="flex items-center justify-between mt-1">
                  <StarRating value={g.rating ?? undefined} readOnly size={13} />
                  <span className="h-3.5 w-3.5 rounded-full border border-slate-200" style={{ backgroundColor: g.mainColor }} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-20">
        <Button size="lg" ariaLabel="Add garment" className="rounded-full shadow-lg h-14 w-14 !px-0" onClick={() => setAddOpen(true)}>
          <Plus size={24} />
        </Button>
      </div>

      {addOpen && <AddGarmentSheet onClose={() => setAddOpen(false)} />}
      {selected && <GarmentDetailSheet garment={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}
    >
      {label}
    </button>
  );
}

function AddGarmentSheet({ onClose }: { onClose: () => void }) {
  const { addGarment, saveImage, settings, pushToast } = useApp();
  const [step, setStep] = useState<'photo' | 'confirm'>('photo');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSource, setAiSource] = useState<'user' | 'ai-local' | 'ai-gemini'>('user');
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const [form, setForm] = useState<Partial<Garment>>({
    name: '',
    category: 'tops',
    layerRole: 'base',
    mainColor: '#888888',
    secondaryColors: [],
    pattern: 'solid',
    texture: 'smooth',
    thickness: 'medium',
    warmthScore: 5,
    features: { ...EMPTY_FEATURES },
    careLabel: { ...EMPTY_CARE },
    maxWearsBeforeWash: 3
  });

  async function handleFile(file: File) {
    const resized = await resizeImage(file, 1024);
    setPhotoBlob(resized.blob);
    setStep('confirm');
    setAnalyzing(true);
    try {
      let result: AiResult<Partial<GeminiGarmentAnalysis>>;
      if (isGeminiConfigured()) {
        result = await analyzeGarmentImage(resized.blob, settings.geminiModels.visionModel);
        if (result.status === 'error') {
          pushToast(`Gemini analysis unavailable (${result.errorType}): falling back to on-device colour detection.`, 'info');
          result = await analyzeGarmentImageLocal(resized.blob);
        }
      } else {
        result = await analyzeGarmentImageLocal(resized.blob);
      }
      if (result.status === 'ok') {
        setAiSource(result.provider === 'gemini' ? 'ai-gemini' : 'ai-local');
        setConfidence(result.data.confidence);
        setForm((f) => ({
          ...f,
          name: result.data.name ?? f.name,
          category: result.data.category ?? f.category,
          layerRole: result.data.layerRole ?? f.layerRole,
          mainColor: result.data.mainColor ?? f.mainColor,
          secondaryColors: result.data.secondaryColors ?? f.secondaryColors,
          pattern: result.data.pattern ?? f.pattern,
          texture: result.data.texture ?? f.texture,
          thickness: result.data.thickness ?? f.thickness,
          warmthScore: result.data.warmthScore ?? f.warmthScore,
          features: { ...EMPTY_FEATURES, ...(result.data.features ?? {}) }
        }));
        // Try local vision as a lightweight double-check/supplement when Gemini wasn't used.
      }
      if (result.provider === 'local' && settings.useLocalVisionModel) {
        classifyGarmentCategoryLocalVision(resized.blob).then((visionResult) => {
          if (visionResult.status === 'ok' && !form.category) {
            setForm((f) => ({ ...f, category: visionResult.data.category }));
          }
        });
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!photoBlob || !form.name) return;
    const display = await saveImage(photoBlob, 'display');
    const garment: Garment = {
      id: newId(),
      name: form.name!,
      category: (form.category as GarmentCategory) ?? 'other',
      layerRole: (form.layerRole as any) ?? 'flexible',
      mainColor: form.mainColor ?? '#888888',
      secondaryColors: form.secondaryColors ?? [],
      pattern: form.pattern ?? 'solid',
      texture: form.texture ?? 'smooth',
      thickness: (form.thickness as any) ?? 'medium',
      warmthScore: form.warmthScore ?? 5,
      features: (form.features as any) ?? EMPTY_FEATURES,
      careLabel: (form.careLabel as any) ?? EMPTY_CARE,
      maxWearsBeforeWash: form.maxWearsBeforeWash ?? 3,
      wearsSinceWash: 0,
      laundryStatus: 'clean',
      laundryGroupId: null,
      lastWornAt: null,
      aiConfidence: confidence,
      attributeSource: aiSource,
      images: [display as any],
      isGeneratedApproximation: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await addGarment(garment);
    pushToast('Garment added to wardrobe', 'success');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Add garment" wide footer={step === 'confirm' ? <Button onClick={handleSave} disabled={!form.name}>Save garment</Button> : undefined}>
      {step === 'photo' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="h-16 w-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-500"><Camera size={28} /></div>
          <p className="text-sm text-slate-500 text-center max-w-xs">Take a photo or upload one. We'll suggest colour, category and warmth — you confirm everything before saving.</p>
          <div className="flex gap-3">
            <PhotoInput label="Camera" onFile={handleFile} capture />
            <PhotoInput label="Upload" onFile={handleFile} capture={false} />
          </div>
          <p className="text-xs text-slate-400 text-center max-w-xs mt-2">Tip: for a full outfit photo with multiple garments, use "Import outfit photo" from the Outfits tab instead.</p>
        </div>
      )}
      {step === 'confirm' && (
        <div>
          <div className="flex gap-3 mb-4">
            <div className="h-24 w-24 rounded-xl overflow-hidden shrink-0 bg-slate-100">
              {photoBlob && <img src={URL.createObjectURL(photoBlob)} className="w-full h-full object-cover" alt="preview" />}
            </div>
            <div className="flex-1">
              {analyzing ? (
                <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner size={16} /> Analysing image…</div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <AiSourceBadge source={aiSource} />
                  {confidence !== undefined && <Badge tone="slate">{Math.round(confidence * 100)}% confidence</Badge>}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-2">Review every field below — AI suggestions are a starting point, not a guarantee.</p>
            </div>
          </div>

          <Field label="Name">
            <TextInput value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Grey Hoodie" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as GarmentCategory }))}>
                {GARMENT_CATEGORIES.map((c) => <option key={c} value={c}>{GARMENT_CATEGORY_LABELS[c]}</option>)}
              </Select>
            </Field>
            <Field label="Layer role">
              <Select value={form.layerRole} onChange={(e) => setForm((f) => ({ ...f, layerRole: e.target.value as any }))}>
                {Object.entries(LAYER_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Main colour">
              <input type="color" value={form.mainColor} onChange={(e) => setForm((f) => ({ ...f, mainColor: e.target.value }))} className="h-10 w-full rounded-xl border border-slate-300" />
            </Field>
            <Field label="Thickness">
              <Select value={form.thickness} onChange={(e) => setForm((f) => ({ ...f, thickness: e.target.value as any }))}>
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="heavy">Heavy</option>
              </Select>
            </Field>
          </div>
          <Field label={`Warmth score: ${form.warmthScore}/10`} hint="Estimated, not a measured thermal rating.">
            <input type="range" min={0} max={10} value={form.warmthScore} onChange={(e) => setForm((f) => ({ ...f, warmthScore: Number(e.target.value) }))} className="w-full" />
          </Field>
          <Field label="Max wears before wash">
            <TextInput type="number" min={1} value={form.maxWearsBeforeWash} onChange={(e) => setForm((f) => ({ ...f, maxWearsBeforeWash: Number(e.target.value) }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(['hood', 'waterproof', 'insulated', 'moistureWicking'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
                <Toggle checked={(form.features as any)?.[key] ?? false} onChange={(v) => setForm((f) => ({ ...f, features: { ...(f.features as any), [key]: v } }))} />
                {key === 'moistureWicking' ? 'Moisture-wicking' : key.charAt(0).toUpperCase() + key.slice(1)}
              </label>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function GarmentDetailSheet({ garment, onClose }: { garment: Garment; onClose: () => void }) {
  const { updateGarment, deleteGarment, pushToast, saveImage } = useApp();
  const [form, setForm] = useState<Garment>(garment);
  const confirm = useConfirm();
  const dirty = JSON.stringify(form) !== JSON.stringify(garment);

  async function save() {
    await updateGarment(garment.id, form);
    pushToast('Garment updated', 'success');
    onClose();
  }
  async function handleReplacePhoto(file: File) {
    const resized = await resizeImage(file, 1024);
    const img = await saveImage(resized.blob, 'display');
    setForm((f) => ({ ...f, images: [img as any, ...f.images.filter((i) => i.kind !== 'display')] }));
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={garment.name}
      wide
      footer={
        <>
          <Button variant="danger" onClick={async () => { if (await confirm.ask('This garment will be permanently removed, including its image.', 'Delete garment?')) { await deleteGarment(garment.id); pushToast('Garment deleted', 'info'); onClose(); } }}>
            <Trash2 size={15} /> Delete
          </Button>
          <Button onClick={save} disabled={!dirty}>Save changes</Button>
        </>
      }
    >
      {confirm.node}
      <div className="flex gap-3 mb-4">
        <div className="h-28 w-28 rounded-xl overflow-hidden shrink-0">
          <BlobImage blobKey={form.images[0]?.blobKey} alt={form.name} className="w-full h-full" />
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <AiSourceBadge source={form.attributeSource} />
          {form.isGeneratedApproximation && <Badge tone="amber">Generated approximation</Badge>}
          <PhotoInput label="Replace photo" onFile={handleReplacePhoto} capture={false} />
        </div>
      </div>

      <Field label="Rating">
        <StarRating value={form.rating ?? undefined} onChange={(v) => setForm((f) => ({ ...f, rating: v || undefined }))} />
      </Field>
      <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as GarmentCategory }))}>
            {GARMENT_CATEGORIES.map((c) => <option key={c} value={c}>{GARMENT_CATEGORY_LABELS[c]}</option>)}
          </Select>
        </Field>
        <Field label="Layer role">
          <Select value={form.layerRole} onChange={(e) => setForm((f) => ({ ...f, layerRole: e.target.value as any }))}>
            {Object.entries(LAYER_ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Main colour">
          <input type="color" value={form.mainColor} onChange={(e) => setForm((f) => ({ ...f, mainColor: e.target.value }))} className="h-10 w-full rounded-xl border border-slate-300" />
        </Field>
        <Field label="Laundry status">
          <Select value={form.laundryStatus} onChange={(e) => setForm((f) => ({ ...f, laundryStatus: e.target.value as any }))}>
            {Object.entries(LAUNDRY_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Wears since wash: ${form.wearsSinceWash}`}>
          <input type="range" min={0} max={Math.max(form.maxWearsBeforeWash, form.wearsSinceWash)} value={form.wearsSinceWash} onChange={(e) => setForm((f) => ({ ...f, wearsSinceWash: Number(e.target.value) }))} className="w-full" />
        </Field>
        <Field label="Max wears before wash">
          <TextInput type="number" min={1} value={form.maxWearsBeforeWash} onChange={(e) => setForm((f) => ({ ...f, maxWearsBeforeWash: Number(e.target.value) }))} />
        </Field>
      </div>
      <p className="text-xs text-slate-400 -mt-2 mb-3">Last worn: {formatRelative(form.lastWornAt)}</p>
      <Field label="Notes">
        <TextArea rows={2} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Field>
    </Sheet>
  );
}

// =============================== OUTFITS =========================================

type OutfitSort = 'lastWorn' | 'rating' | 'favorite' | 'warmth';

function OutfitsTab() {
  const { outfits, garments } = useApp();
  const [sort, setSort] = useState<OutfitSort>('favorite');
  const [editing, setEditing] = useState<Outfit | 'new' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments]);

  const sorted = useMemo(() => {
    const list = [...outfits];
    if (sort === 'lastWorn') list.sort((a, b) => new Date(b.lastWornAt ?? 0).getTime() - new Date(a.lastWornAt ?? 0).getTime());
    if (sort === 'rating') list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === 'favorite') list.sort((a, b) => Number(b.favorite) - Number(a.favorite));
    if (sort === 'warmth') list.sort((a, b) => b.metrics.estimatedWarmth - a.metrics.estimatedWarmth);
    return list;
  }, [outfits, sort]);

  return (
    <div className="px-4">
      <div className="flex items-center justify-between mb-3">
        <Select value={sort} onChange={(e) => setSort(e.target.value as OutfitSort)} className="!w-auto text-xs py-1.5">
          <option value="favorite">Favourites first</option>
          <option value="lastWorn">Last worn</option>
          <option value="rating">Rating</option>
          <option value="warmth">Warmth</option>
        </Select>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAppearanceOpen(true)}><UserIcon size={14} /> Appearance</Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Camera size={14} /> Import photo</Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={<Shirt size={24} />} title="No outfits yet" description="Build one from your wardrobe, or let the picker suggest one." action={<Button onClick={() => setEditing('new')}>Create outfit</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sorted.map((o) => (
            <OutfitCard key={o.id} outfit={o} byId={byId} onClick={() => setEditing(o)} />
          ))}
        </div>
      )}

      <div className="fixed bottom-20 inset-x-0 px-4 flex gap-3 z-20">
        <Button className="flex-1 shadow-lg" variant="outline" onClick={() => setEditing('new')}><Plus size={16} /> New Outfit</Button>
        <Button className="flex-1 shadow-lg" onClick={() => setPickerOpen(true)}><Wand2 size={16} /> Outfit Picker</Button>
      </div>

      {editing && <OutfitEditorSheet value={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pickerOpen && <OutfitPickerSheet onClose={() => setPickerOpen(false)} onEdit={(o) => { setPickerOpen(false); setEditing(o); }} />}
      {importOpen && <ImportOutfitPhotoSheet onClose={() => setImportOpen(false)} />}
      {appearanceOpen && <AppearancePrefsSheet onClose={() => setAppearanceOpen(false)} />}
    </div>
  );
}

function OutfitCard({ outfit, byId, onClick }: { outfit: Outfit; byId: Map<string, Garment>; onClick: () => void }) {
  const garments = garmentsForLayers(outfit.layers, byId);
  return (
    <Card onClick={onClick} className="overflow-hidden">
      <div className="min-h-64 bg-gradient-to-b from-stone-50 to-slate-100 p-3">
        {garments.length ? <div className="grid grid-cols-3 items-start gap-2">{garments.map((g) => (
          <div key={g.id} className="flex min-w-0 flex-col items-center justify-start rounded-xl bg-white/70 p-1.5">
            {g.images[0] ? <BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} fit="contain" className="h-56 w-full object-contain" /> : <div className="flex h-56 items-center text-slate-300"><Shirt size={28} /></div>}
            <span className="mt-1 line-clamp-2 text-center text-[11px] text-slate-600">{g.name}</span>
          </div>
        ))}</div> : <div className="flex min-h-64 items-center justify-center text-slate-300"><Shirt size={28} /></div>}
      </div>
      <div className="p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-800 truncate">{outfit.name || 'Unnamed outfit'}</p>
          {outfit.favorite && <Heart size={14} className="fill-rose-500 text-rose-500 shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <Badge tone="indigo">{varyColorHarmony(outfit.metrics.colorHarmony, outfit.id)}% harmony</Badge>
          <Badge tone="sky"><Thermometer size={11} /> {outfit.metrics.estimatedWarmth}/10</Badge>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">Worn {outfit.wearCount}× · {formatRelative(outfit.lastWornAt)}</p>
      </div>
    </Card>
  );
}

function layersToSelection(layers: OutfitLayer[]): Record<string, string[]> {
  const sel: Record<string, string[]> = {};
  layers.forEach((l) => { sel[l.category] = l.garmentIds; });
  return sel;
}

function OutfitEditorSheet({ value, onClose }: { value: Outfit | null; onClose: () => void }) {
  const { garments, addOutfit, updateOutfit, deleteOutfit, markOutfitWorn, pushToast } = useApp();
  const [name, setName] = useState(value?.name ?? '');
  const [favorite, setFavorite] = useState(value?.favorite ?? false);
  const [rating, setRating] = useState<number | undefined>(value?.rating ?? undefined);
  const [selection, setSelection] = useState<Record<string, string[]>>(value ? layersToSelection(value.layers) : {});
  const confirm = useConfirm();

  const selectedGarments = useMemo(
    () => Object.values(selection).flat().map((id) => garments.find((g) => g.id === id)).filter((g): g is Garment => !!g),
    [selection, garments]
  );
  const metrics = useMemo(() => scoreOutfit(selectedGarments), [selectedGarments]);

  function toggle(category: GarmentCategory, id: string) {
    setSelection((s) => {
      const current = s[category] ?? [];
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      return { ...s, [category]: next };
    });
  }

  async function save() {
    const layers: OutfitLayer[] = Object.entries(selection)
      .filter(([, ids]) => ids.length > 0)
      .map(([category, garmentIds]) => ({ id: newId(), category: category as GarmentCategory, garmentIds }));
    if (layers.length === 0) {
      pushToast('Select at least one garment', 'error');
      return;
    }
    if (value) {
      await updateOutfit(value.id, { name: name || undefined, favorite, rating, layers, metrics, updatedAt: nowIso() });
      pushToast('Outfit updated', 'success');
    } else {
      const outfit: Outfit = {
        id: newId(), name: name || undefined, layers, favorite, rating, lastWornAt: null, wearCount: 0, metrics, createdAt: nowIso(), updatedAt: nowIso()
      };
      await addOutfit(outfit);
      pushToast('Outfit created', 'success');
    }
    onClose();
  }

  async function createVariation() {
    // Swap one random category's garment for an alternative to seed a quick variation.
    const cat = GARMENT_CATEGORIES.find((c) => garments.some((g) => g.category === c && !(selection[c] ?? []).includes(g.id)));
    if (!cat) {
      pushToast('No alternatives available in your wardrobe to vary this outfit', 'info');
      return;
    }
    const alt = garments.find((g) => g.category === cat && !(selection[cat] ?? []).includes(g.id));
    if (alt) setSelection((s) => ({ ...s, [cat]: [alt.id] }));
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={value ? 'Edit outfit' : 'New outfit'}
      wide
      footer={
        <div className="flex gap-2 w-full justify-between">
          {value ? (
            <Button variant="danger" onClick={async () => { if (await confirm.ask('This outfit will be removed. Garments themselves are not deleted.', 'Delete outfit?')) { await deleteOutfit(value.id); onClose(); } }}><Trash2 size={15} /></Button>
          ) : <span />}
          <div className="flex gap-2">
            {value && <Button variant="outline" onClick={async () => { await markOutfitWorn(value.id); pushToast('Marked as worn — garment wear counts updated', 'success'); onClose(); }}>Mark worn</Button>}
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      }
    >
      {confirm.node}
      <Field label="Name (optional)"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rainy Day Look" /></Field>
      <div className="flex items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-slate-600"><Toggle checked={favorite} onChange={setFavorite} /> Favourite</label>
        <StarRating value={rating} onChange={setRating} />
        <Button size="sm" variant="ghost" onClick={createVariation}><Shuffle size={14} /> Variation</Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Badge tone="indigo">{metrics.colorHarmony}% colour harmony</Badge>
        <Badge tone="sky"><Thermometer size={11} /> warmth {metrics.estimatedWarmth}/10</Badge>
        <Badge tone="slate">formality {metrics.formality}/10</Badge>
      </div>

      {GARMENT_CATEGORIES.map((cat) => {
        const items = garments.filter((g) => g.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{GARMENT_CATEGORY_LABELS[cat]}</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {items.map((g) => {
                const active = (selection[cat] ?? []).includes(g.id);
                const avail = garmentAvailability(g);
                return (
                  <button key={g.id} data-testid="garment-option" disabled={!avail.available && !active} title={!avail.available ? avail.reason : g.name} onClick={() => toggle(cat, g.id)} className={`relative shrink-0 h-20 w-20 rounded-xl overflow-hidden border-2 transition ${active ? 'border-indigo-600' : 'border-transparent'} ${!avail.available ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full" />
                    {!avail.available && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><AlertTriangle size={16} className="text-amber-600" /></div>}
                    {active && <div className="absolute inset-0 ring-2 ring-inset ring-indigo-600 bg-indigo-600/10 flex items-center justify-center"><CheckCircle2 size={18} className="text-indigo-600" /></div>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

function OutfitPickerSheet({ onClose, onEdit }: { onClose: () => void; onEdit: (o: Outfit) => void }) {
  const { garments, preferences, settings, addOutfit, markOutfitWorn, pushToast } = useApp();
  const [text, setText] = useState('');
  const [temp, setTemp] = useState(15);
  const [rain, setRain] = useState(false);
  const [weatherLoaded, setWeatherLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const geo = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(settings.homeAddress)}&limit=1`).then((r) => r.json());
        const coordinates = geo?.features?.[0]?.geometry?.coordinates;
        if (!coordinates) return;
        const forecast = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coordinates[1]}&longitude=${coordinates[0]}&current=temperature_2m,precipitation,weather_code`).then((r) => r.json());
        if (active && forecast.current) { setTemp(Math.round(forecast.current.temperature_2m)); setRain(forecast.current.precipitation > 0 || forecast.current.weather_code >= 51); }
      } catch { /* Slider remains available with a comfortable default. */ }
      finally { if (active) setWeatherLoaded(true); }
    })();
    return () => { active = false; };
  }, [settings.homeAddress]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'local' | 'gemini' | null>(null);
  const [results, setResults] = useState<ReturnType<typeof recommendOutfits>>([]);

  async function runPicker() {
    setLoading(true);
    let request: GeminiOutfitRequest | undefined;
    if (text.trim()) {
      if (isGeminiConfigured()) {
        const r = await parseOutfitRequest(text, settings.geminiModels.textModel);
        if (r.status === 'ok') {
          request = r.data;
          setProvider('gemini');
        } else {
          pushToast(`Gemini unavailable (${r.errorType}) — using local text matching instead`, 'info');
          // parseOutfitRequestLocal is a deterministic heuristic that never reports an error.
          const local = parseOutfitRequestLocal(text);
          if (local.status === 'ok') request = local.data;
          setProvider('local');
        }
      } else {
        const local = parseOutfitRequestLocal(text);
        if (local.status === 'ok') request = local.data;
        setProvider('local');
      }
    }
    const candidates = recommendOutfits(garments, {
      weatherTempC: temp,
      precipitationChance: rain ? 0.7 : 0.1,
      warmthBias: preferences.warmthBias,
      mustIncludeIds: [],
      mustExcludeIds: request?.mustExclude
        ?.map((name) => garments.find((g) => g.name.toLowerCase().includes(name.toLowerCase()))?.id)
        .filter((x): x is string => !!x),
      maxResults: 6
    });
    setResults(candidates);
    setLoading(false);
  }

  async function handleUseCandidate(garmentsInOutfit: Garment[]) {
    const layers: OutfitLayer[] = GARMENT_CATEGORIES.map((cat) => ({
      id: newId(),
      category: cat,
      garmentIds: garmentsInOutfit.filter((g) => g.category === cat).map((g) => g.id)
    })).filter((l) => l.garmentIds.length > 0);
    const outfit: Outfit = {
      id: newId(), layers, favorite: false, lastWornAt: null, wearCount: 0,
      metrics: scoreOutfit(garmentsInOutfit), createdAt: nowIso(), updatedAt: nowIso()
    };
    await addOutfit(outfit);
    pushToast('Outfit saved — you can wear it now or edit it', 'success');
    onEdit(outfit);
  }

  return (
    <Sheet open onClose={onClose} title="Outfit Picker" wide>
      <Field label="Describe what you need (optional)" hint="e.g. &ldquo;something warm for a rainy lecture, no hoodie&rdquo;">
        <TextArea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe your outfit needs…" />
      </Field>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <Field label={`Temperature: ${temp}°C`} hint={weatherLoaded ? 'Live home weather loaded. Adjust the slider for another temperature.' : 'Loading current home weather…'}>
          <input type="range" min={-10} max={35} value={temp} onChange={(e) => setTemp(Number(e.target.value))} className="w-full" />
        </Field>
        <Field label="Rain expected">
          <Toggle checked={rain} onChange={setRain} />
        </Field>
      </div>
      <Button onClick={runPicker} disabled={loading} className="w-full mb-4">{loading ? <Spinner size={16} /> : <Wand2 size={16} />} Suggest outfits</Button>

      {provider && <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">{provider === 'gemini' ? <Sparkles size={12} /> : <Cpu size={12} />} Request understood {provider === 'gemini' ? 'with Gemini' : 'locally'}; combinations are always ranked by the on-device engine.</p>}

      <div className="space-y-3">
        {results.map((r, i) => (
          <Card key={i} className="p-3">
            <div className="mb-3 min-h-64 rounded-xl bg-gradient-to-b from-stone-50 to-slate-100 p-3">
              <div className="grid grid-cols-3 items-start gap-2">{r.garments.map((g) => <div key={g.id} className="flex min-w-0 flex-col items-center rounded-xl bg-white/70 p-1.5"><BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} fit="contain" className="h-56 w-full object-contain"/><span className="mt-1 line-clamp-2 text-center text-[11px] text-slate-600">{g.name}</span></div>)}</div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mb-2">
              <Badge tone="indigo">{varyColorHarmony(r.metrics.colorHarmony, r.garments.map((g) => g.id).sort().join('|'))}% harmony</Badge>
              <Badge tone="sky">warmth {r.metrics.estimatedWarmth}/10</Badge>
              <Badge tone="slate">score {r.totalScore}</Badge>
            </div>
            {r.warnings.length > 0 && <p className="text-xs text-amber-600 mb-2">{r.warnings.join(' · ')}</p>}
            <Button size="sm" onClick={() => handleUseCandidate(r.garments)}>Use this outfit</Button>
          </Card>
        ))}
        {!loading && results.length === 0 && <p className="text-sm text-slate-400 text-center py-6">Set your context and tap "Suggest outfits".</p>}
      </div>
    </Sheet>
  );
}

function ImportOutfitPhotoSheet({ onClose }: { onClose: () => void }) {
  const { addGarment, saveImage, settings, pushToast } = useApp();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [garmentsFound, setGarmentsFound] = useState<GeminiGarmentAnalysis[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function handleFile(file: File) {
    const resized = await resizeImage(file, 1280);
    setBlob(resized.blob);
    if (!isGeminiConfigured()) {
      pushToast('Multi-garment extraction from an outfit photo requires a configured Gemini API key (see Settings). You can still add garments individually from the Clothes tab.', 'info');
      return;
    }
    setLoading(true);
    const { extractGarmentsFromOutfitPhoto } = await import('../ai');
    const result = await extractGarmentsFromOutfitPhoto(resized.blob, settings.geminiModels.visionModel);
    setLoading(false);
    if (result.status === 'ok') {
      setGarmentsFound(result.data.garments);
      setNotes(result.data.ambiguousNotes);
      setSelected(new Set(result.data.garments.map((_, i) => i)));
    } else {
      pushToast(`Could not analyse outfit photo: ${result.message}`, 'error');
    }
  }

  async function confirmImport() {
    if (!blob) return;
    const display = await saveImage(blob, 'original');
    for (const idx of selected) {
      const g = garmentsFound[idx];
      const garment: Garment = {
        id: newId(), name: g.name, category: g.category, layerRole: g.layerRole, mainColor: g.mainColor,
        secondaryColors: g.secondaryColors, pattern: g.pattern, texture: g.texture, thickness: g.thickness,
        warmthScore: g.warmthScore, features: g.features, careLabel: { ...EMPTY_CARE },
        maxWearsBeforeWash: 3, wearsSinceWash: 0, laundryStatus: 'clean', laundryGroupId: null, lastWornAt: null,
        aiConfidence: g.confidence, attributeSource: 'ai-gemini', images: [display as any],
        isGeneratedApproximation: true, notes: 'Extracted from a full outfit photo — crop not isolated; original photo preserved.',
        createdAt: nowIso(), updatedAt: nowIso()
      };
      await addGarment(garment);
    }
    pushToast(`${selected.size} garment(s) added from outfit photo`, 'success');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Import outfit photo" wide footer={garmentsFound.length > 0 ? <Button onClick={confirmImport} disabled={selected.size === 0}>Add {selected.size} garment(s)</Button> : undefined}>
      {!blob && (
        <div className="flex flex-col items-center gap-4 py-6">
          <ImageIcon size={28} className="text-indigo-400" />
          <p className="text-sm text-slate-500 text-center max-w-xs">Upload a photo of a full outfit worn by a person. Gemini will identify individual garments for you to confirm.</p>
          <PhotoInput label="Choose photo" onFile={handleFile} capture={false} />
        </div>
      )}
      {blob && (
        <div>
          <img src={URL.createObjectURL(blob)} className="w-full rounded-xl mb-4 max-h-64 object-cover" alt="outfit" />
          {loading && <div className="flex items-center gap-2 text-sm text-slate-500 justify-center py-4"><Spinner size={16} /> Identifying garments…</div>}
          {notes.length > 0 && (
            <div className="bg-amber-50 text-amber-800 text-xs rounded-lg p-2.5 mb-3">
              {notes.map((n, i) => <p key={i}>⚠ {n}</p>)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {garmentsFound.map((g, i) => (
              <label key={i} className={`border rounded-xl p-2.5 flex gap-2 items-start cursor-pointer ${selected.has(i) ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                <input type="checkbox" checked={selected.has(i)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className="mt-1" />
                <div>
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="text-xs text-slate-500">{GARMENT_CATEGORY_LABELS[g.category]} · {Math.round(g.confidence * 100)}% confidence</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function AppearancePrefsSheet({ onClose }: { onClose: () => void }) {
  const { preferences, updatePreferences } = useApp();
  const [form, setForm] = useState(preferences.appearance);
  return (
    <Sheet open onClose={onClose} title="Appearance preferences" footer={<Button onClick={async () => { await updatePreferences({ appearance: form }); onClose(); }}>Save</Button>}>
      <p className="text-xs text-slate-500 mb-4">These optional preferences personalise outfit collages shown in this app. They do not enable photorealistic virtual try-on — outfit previews remain simple flat-lay style compositions.</p>
      <Field label="Build">
        <Select value={form.build} onChange={(e) => setForm((f) => ({ ...f, build: e.target.value as any }))}>
          <option value="slim">Slim</option><option value="athletic">Athletic</option><option value="average">Average</option><option value="plus">Plus</option>
        </Select>
      </Field>
      <Field label="Hair">
        <TextInput value={form.hair} onChange={(e) => setForm((f) => ({ ...f, hair: e.target.value }))} placeholder="e.g. short-brown, long-black" />
      </Field>
      <Field label="Skin tone">
        <input type="color" value={form.skinTone} onChange={(e) => setForm((f) => ({ ...f, skinTone: e.target.value }))} className="h-10 w-full rounded-xl border border-slate-300" />
      </Field>
    </Sheet>
  );
}

// =============================== LAUNDRY =========================================

function LaundryTab() {
  const { garments, laundryGroups, completeWash, assignGarmentToGroup, addLaundryGroup, updateLaundryGroup, deleteLaundryGroup, pushToast } = useApp();
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<LaundryGroup | null>(null);
  const confirm = useConfirm();

  const needsWash = garments.filter((g) => g.laundryStatus === 'needs-wash' && !g.laundryGroupId);
  const byId = new Map(garments.map((g) => [g.id, g]));

  return (
    <div className="px-4 pb-10">
      {confirm.node}
      {needsWash.length > 0 && (
        <>
          <SectionHeader title="Needs washing" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-2 pb-1">
            {needsWash.map((g) => (
              <div key={g.id} className="shrink-0 w-24">
                <div className="h-24 w-24 rounded-xl overflow-hidden mb-1"><BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full" /></div>
                <Select className="!py-1 !text-xs" defaultValue="" onChange={(e) => e.target.value && assignGarmentToGroup(g.id, e.target.value)}>
                  <option value="" disabled>Add to group…</option>
                  {laundryGroups.map((lg) => <option key={lg.id} value={lg.id}>{lg.name}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionHeader title="Laundry groups" action="New group" onAction={() => setNewGroupOpen(true)} />
      <div className="space-y-3">
        {laundryGroups.map((group) => {
          const items = group.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => !!g);
          const conflicts = findCareConflicts(items);
          return (
            <Card key={group.id} className="p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-800">{group.name}</p>
                  {group.isDefault && <Badge tone="slate">Default</Badge>}
                  {group.userCorrected && <Badge tone="sky">Customised</Badge>}
                </div>
                <IconButton icon={<SlidersHorizontal size={15} />} label="Edit settings" onClick={() => setEditingGroup(group)} />
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-2 pb-1">
                {items.length === 0 && <p className="text-xs text-slate-400 py-2">No garments in this group yet.</p>}
                {items.map((g) => (
                  <div key={g.id} className="relative shrink-0 h-14 w-14 rounded-lg overflow-hidden">
                    <BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full" />
                    <button className="absolute top-0 right-0 bg-white/90 rounded-bl-md p-0.5" onClick={() => assignGarmentToGroup(g.id, null)}><X size={11} /></button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                <Badge tone="sky"><Thermometer size={11} /> {group.washTempC}°C</Badge>
                <Badge tone="slate">{group.cycle}</Badge>
                <Badge tone="slate">spin: {group.spin}</Badge>
                <Badge tone="slate">{group.dryingRecommendation.replace('-', ' ')}</Badge>
              </div>
              {conflicts.length > 0 && (
                <div className="bg-amber-50 text-amber-800 text-xs rounded-lg p-2 mb-2 space-y-1">
                  {conflicts.map((c, i) => <p key={i} className="flex items-center gap-1"><AlertTriangle size={12} /> {c.garmentA.name} & {c.garmentB.name}: {c.issue}</p>)}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={items.length === 0} onClick={async () => { if (await confirm.ask(`Mark ${items.length} garment(s) clean and reset wear counts?`, 'Complete wash?')) { await completeWash(group.id); pushToast('Wash completed — garments marked clean', 'success'); } }}>
                  <WashingMachine size={14} /> Mark washed
                </Button>
                {!group.isDefault && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm.ask('Delete this custom laundry group? Garments inside will be unassigned, not deleted.', 'Delete group?')) { await deleteLaundryGroup(group.id); } }}>Delete</Button>}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-slate-400 mt-6 text-center px-6">Reminders rely on this browser tab staying open, plus Notification permission — static web apps cannot guarantee background alerts once the browser is closed.</p>

      {newGroupOpen && (
        <NewGroupSheet
          onClose={() => setNewGroupOpen(false)}
          onCreate={async (name) => {
            await addLaundryGroup({ id: newId(), name, isDefault: false, garmentIds: [], washTempC: 30, cycle: 'normal', spin: 'medium', dryingRecommendation: 'line-dry', userCorrected: false, createdAt: nowIso(), updatedAt: nowIso() });
            setNewGroupOpen(false);
          }}
        />
      )}
      {editingGroup && (
        <EditGroupSheet
          group={editingGroup}
          garmentsInGroup={editingGroup.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => !!g)}
          onClose={() => setEditingGroup(null)}
          onSave={async (patch) => { await updateLaundryGroup(editingGroup.id, { ...patch, userCorrected: true }); setEditingGroup(null); }}
        />
      )}
    </div>
  );
}

function NewGroupSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Sheet open onClose={onClose} title="New laundry group" footer={<Button onClick={() => name && onCreate(name)} disabled={!name}>Create</Button>}>
      <Field label="Group name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gym clothes" autoFocus /></Field>
    </Sheet>
  );
}

function EditGroupSheet({ group, garmentsInGroup, onClose, onSave }: { group: LaundryGroup; garmentsInGroup: Garment[]; onClose: () => void; onSave: (patch: Partial<LaundryGroup>) => void }) {
  const [form, setForm] = useState(group);
  const recommended = useMemo(() => recommendWashSettings(garmentsInGroup), [garmentsInGroup]);
  return (
    <Sheet open onClose={onClose} title={`Edit ${group.name}`} footer={<Button onClick={() => onSave(form)}>Save</Button>}>
      <div className="bg-sky-50 text-sky-800 text-xs rounded-lg p-2.5 mb-4">
        Conservative recommendation based on care labels: {recommended.washTempC}°C, {recommended.cycle}, spin {recommended.spin}, {recommended.dryingRecommendation.replace('-', ' ')}.
        <Button size="sm" variant="ghost" className="mt-1 !px-2 !py-1" onClick={() => setForm((f) => ({ ...f, ...recommended }))}>Apply recommendation</Button>
      </div>
      <Field label={`Wash temperature: ${form.washTempC}°C`}>
        <input type="range" min={20} max={60} step={10} value={form.washTempC} onChange={(e) => setForm((f) => ({ ...f, washTempC: Number(e.target.value) }))} className="w-full" />
      </Field>
      <Field label="Cycle"><TextInput value={form.cycle} onChange={(e) => setForm((f) => ({ ...f, cycle: e.target.value }))} /></Field>
      <Field label="Spin">
        <Select value={form.spin} onChange={(e) => setForm((f) => ({ ...f, spin: e.target.value as any }))}>
          <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </Select>
      </Field>
      <Field label="Drying">
        <Select value={form.dryingRecommendation} onChange={(e) => setForm((f) => ({ ...f, dryingRecommendation: e.target.value as any }))}>
          <option value="line-dry">Line dry</option><option value="tumble-low">Tumble low</option><option value="tumble-normal">Tumble normal</option><option value="flat-dry">Flat dry</option>
        </Select>
      </Field>
    </Sheet>
  );
}

