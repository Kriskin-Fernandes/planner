// ---------------------------------------------------------------------------
// App shell: bottom navigation across the three main areas (Wardrobe, Fridge,
// Planner), a shared header with Settings access, toasts, and a first-run
// welcome sheet explaining local-only storage and demo data.
// ---------------------------------------------------------------------------
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Shirt, Refrigerator, CalendarClock, Settings as SettingsIcon, Sparkles, House } from 'lucide-react';
import { AppProvider, useApp } from './context';
import { BottomNav, ToastContainer, LoadingScreen, Button, Sheet, DemoBadge } from './components';
import { compareUkBasket } from './prices';
import { geocode, getTransitWalkingSegments, findSupermarketsNearRoute } from './geo';

const Wardrobe = React.lazy(() => import('./features/Wardrobe'));
const Fridge = React.lazy(() => import('./features/Fridge'));
const Planner = React.lazy(() => import('./features/Planner'));
const Home = React.lazy(() => import('./features/Home'));
const SettingsSheet = React.lazy(() => import('./features/Settings'));

type MainArea = 'home' | 'wardrobe' | 'fridge' | 'planner';

const AREA_TITLES: Record<MainArea, string> = {
  home: 'Today',
  wardrobe: 'Wardrobe',
  fridge: 'Fridge',
  planner: 'Planner'
};

function Shell() {
  const { loading, settings, shoppingItems, updateShoppingItem, updateSettings } = useApp();
  const [area, setArea] = useState<MainArea>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shoppingRequest, setShoppingRequest] = useState(0);
  const pricesWarmed = useRef(false);

  useEffect(() => {
    if (loading || pricesWarmed.current) return;
    pricesWarmed.current = true;
    const pending = shoppingItems.filter((item) => !item.purchased);
    if (pending.length) compareUkBasket(pending).then(async ({ priceByItem }) => {
      await Promise.all(pending.map((item) => {
        const price = priceByItem[item.id];
        return price === undefined || (item.priceSource === 'verified' && item.estimatedPrice === price)
          ? Promise.resolve()
          : updateShoppingItem(item.id, { estimatedPrice: price, priceSource: 'verified' });
      }));
    }).catch(() => { /* Smart Shopping will show a clear price feed error if the source is unavailable. */ });
    if (settings.googleMapsApiKey.trim()) {
      void (async () => {
        const home = await geocode(settings.homeAddress || '42 Redfield Lane, London, SW5 0RQ');
        const uni = await geocode('Imperial College London');
        if (home.status !== 'ok' || uni.status !== 'ok' || !home.data[0] || !uni.data[0]) return;
        const route = await getTransitWalkingSegments(uni.data[0].point, home.data[0].point, settings.googleMapsApiKey.trim());
        if (route.status === 'ok') {
          for (const segment of route.data.segments) await findSupermarketsNearRoute(segment, 300, settings.googleMapsApiKey.trim());
        }
      })().catch(() => { /* Smart Shopping retries if a provider is temporarily unavailable. */ });
    }
  }, [loading]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-100 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg text-slate-900">{AREA_TITLES[area]}</h1>
          <p className="text-[11px] text-slate-400 -mt-0.5">Student Daily Planner · stored on this device</p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="h-9 w-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition"
          aria-label="Settings"
        >
          <SettingsIcon size={17} />
        </button>
      </header>

      <main className="flex-1 pt-3">
        <Suspense fallback={<LoadingScreen label="Loading…" />}>
          {area === 'home' && <Home openPlanner={() => { setShoppingRequest((value) => value + 1); setArea('planner'); }} />}
          {area === 'wardrobe' && <Wardrobe />}
          {area === 'fridge' && <Fridge />}
          {area === 'planner' && <Planner shoppingRequest={shoppingRequest} />}
        </Suspense>
      </main>

      <BottomNav
        items={[
          { key: 'home', label: 'Today', icon: <House size={20} /> },
          { key: 'wardrobe', label: 'Wardrobe', icon: <Shirt size={20} /> },
          { key: 'fridge', label: 'Fridge', icon: <Refrigerator size={20} /> },
          { key: 'planner', label: 'Planner', icon: <CalendarClock size={20} /> }
        ]}
        active={area}
        onChange={setArea}
      />

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsSheet onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {!settings.onboardingSeen && <WelcomeSheet onClose={() => updateSettings({ onboardingSeen: true })} />}

      <ToastContainer />
    </div>
  );
}

function WelcomeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Welcome" footer={<Button onClick={onClose} className="w-full">Get started</Button>}>
      <div className="flex items-center gap-2 mb-3 text-indigo-600">
        <Sparkles size={18} />
        <p className="font-medium">Wardrobe · Fridge · Planner in one app</p>
      </div>
      <ul className="text-sm text-slate-600 space-y-2 mb-4 list-disc list-inside">
        <li>Everything is stored locally in this browser (IndexedDB) — it does not sync to other devices automatically. Use Settings → Export to back up.</li>
        <li>Sample data is preloaded so you can explore right away — it's clearly marked as demo content where shown.</li>
        <li>AI features (photo analysis, natural-language parsing) work on-device for free. Add an optional Gemini API key in Settings for richer results.</li>
      </ul>
      <div className="flex items-center gap-2 mb-1"><DemoBadge /><span className="text-xs text-slate-400">appears on seeded sample items</span></div>
    </Sheet>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
