// ---------------------------------------------------------------------------
// Settings: Gemini API key configuration, model selection, notifications,
// local data export/import/reset, and PWA install. This is the only place
// in the app that touches the Gemini key -- see ai.ts for storage semantics.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import {
  KeyRound, ShieldAlert, Bell, Download, Upload, Trash2, Smartphone, Info, ExternalLink, MapPin,
  Eye, EyeOff, CheckCircle2, Cpu
} from 'lucide-react';
import { useApp } from '../context';
import { Sheet, Field, TextInput, Button, Toggle, Badge, useConfirm, Card } from '../components';
import { setGeminiApiKey, clearGeminiApiKey, getGeminiApiKey, isGeminiConfigured } from '../ai';

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings, pushToast, exportData, importData, resetAllData } = useApp();
  const confirm = useConfirm();
  const [keyInput, setKeyInput] = useState(getGeminiApiKey() ?? '');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const [configured, setConfigured] = useState(isGeminiConfigured());
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function saveKey() {
    setGeminiApiKey(keyInput.trim(), remember);
    updateSettings({ geminiRememberKey: remember });
    setConfigured(!!keyInput.trim());
    pushToast(keyInput.trim() ? (remember ? 'Gemini key saved on this device' : 'Gemini key set for this session') : 'Gemini key cleared', 'success');
  }

  function clearKey() {
    clearGeminiApiKey();
    setKeyInput('');
    setConfigured(false);
    updateSettings({ geminiRememberKey: false });
    pushToast('Gemini key removed', 'info');
  }

  async function requestNotifications() {
    if (!('Notification' in window)) {
      pushToast('This browser does not support notifications', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    await updateSettings({ notificationsEnabled: perm === 'granted' });
    pushToast(perm === 'granted' ? 'Notifications enabled' : 'Notification permission not granted', perm === 'granted' ? 'success' : 'info');
  }

  async function handleExport() {
    const blob = await exportData();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Backup downloaded (data + images, no API key included)', 'success');
  }

  async function handleImportFile(file: File) {
    const result = await importData(file);
    pushToast(result.message, result.ok ? 'success' : 'error');
  }

  async function handleReset() {
    if (await confirm.ask('This permanently deletes all wardrobe, fridge and planner data from this browser. This cannot be undone. Your Gemini key (if remembered) is also cleared.', 'Reset all data?')) {
      clearKey();
      await resetAllData();
      pushToast('All local data has been reset', 'info');
    }
  }

  async function handleInstall() {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  }

  return (
    <Sheet open onClose={onClose} title="Settings" wide>
      {confirm.node}

      {/* ---------------- Gemini ---------------- */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-800 text-sm">Gemini API key (optional)</h3>
          {configured && <Badge tone="green"><CheckCircle2 size={11} /> Configured</Badge>}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Adding a free-tier Gemini key enables richer photo analysis, natural-language outfit/task parsing, receipt and
          recipe extraction. Without a key, the app uses on-device fallbacks for all of these (clearly labelled "On-device" in the UI) — nothing is blocked.
        </p>
        <div className="bg-amber-50 text-amber-800 text-xs rounded-lg p-3 mb-3 flex gap-2">
          <ShieldAlert size={14} className="shrink-0 mt-0.5" />
          <span>
            This is a static web app with no backend, so your key is sent directly from this browser to Google's API and is visible to
            any script running on this page. It is <strong>never</strong> written into source code, build output, logs, or exported data.
            By default it is kept only in memory for this tab and cleared on reload. The "remember on this device" option below stores it in
            this browser's localStorage for convenience only — that is <strong>not secure storage</strong>; anything that can run JavaScript
            on this page (e.g. a malicious browser extension) could read it. A genuinely secret key requires a backend, which this prototype intentionally does not have.
          </span>
        </div>
        <Field label="API key">
          <div className="relative">
            <TextInput type={showKey ? 'text' : 'password'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Paste your Gemini API key" className="pr-10" />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowKey((s) => !s)}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3">
          <Toggle checked={remember} onChange={setRemember} /> Remember on this device (not secure — see warning above)
        </label>
        <div className="flex gap-2 mb-3">
          <Button onClick={saveKey} disabled={!keyInput.trim()}>Save key</Button>
          {configured && <Button variant="outline" onClick={clearKey}>Clear key</Button>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Text model" hint="e.g. gemini-2.5-flash">
            <TextInput value={settings.geminiModels.textModel} onChange={(e) => updateSettings({ geminiModels: { ...settings.geminiModels, textModel: e.target.value } })} />
          </Field>
          <Field label="Vision model" hint="e.g. gemini-2.5-flash">
            <TextInput value={settings.geminiModels.visionModel} onChange={(e) => updateSettings({ geminiModels: { ...settings.geminiModels, visionModel: e.target.value } })} />
          </Field>
        </div>
        <a className="text-xs text-indigo-600 inline-flex items-center gap-1" href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noreferrer">
          Check current model availability on your account <ExternalLink size={11} />
        </a>
      </section>

      {/* ---------------- On-device AI ---------------- */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2"><Cpu size={16} className="text-sky-600" /><h3 className="font-semibold text-slate-800 text-sm">On-device AI</h3></div>
        <label className="flex items-center justify-between text-sm text-slate-600">
          <span>Use local vision model (Transformers.js) as a supplementary category check<br /><span className="text-xs text-slate-400">Downloads a ~150MB CLIP model on first use. Off by default to save mobile data.</span></span>
          <Toggle checked={settings.useLocalVisionModel} onChange={(v) => updateSettings({ useLocalVisionModel: v })} />
        </label>
      </section>

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2"><MapPin size={16} className="text-indigo-600"/><h3 className="font-semibold text-slate-800 text-sm">Home location & weather</h3></div>
        <p className="text-xs text-slate-500 mb-2">Your location is saved on this device for the Today page.</p>
        <TextInput value={settings.homeAddress} onChange={(e) => updateSettings({ homeAddress: e.target.value })} placeholder="Town, postcode, or address" />
      </section>

      {/* ---------------- Notifications ---------------- */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2"><Bell size={16} className="text-indigo-600" /><h3 className="font-semibold text-slate-800 text-sm">Reminders & notifications</h3></div>
        <p className="text-xs text-slate-500 mb-3">
          Reminders fire in-app, and as a browser notification if permission is granted, while this tab is open. Static web apps
          cannot guarantee background delivery once the browser is closed or the OS suspends it — this is a browser/OS limitation, not configurable away.
        </p>
        <Button variant="outline" onClick={requestNotifications}>
          <Bell size={15} /> {settings.notificationsEnabled ? 'Notifications enabled' : 'Enable browser notifications'}
        </Button>
      </section>

      {/* ---------------- Data ---------------- */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2"><Download size={16} className="text-indigo-600" /><h3 className="font-semibold text-slate-800 text-sm">Your data</h3></div>
        <p className="text-xs text-slate-500 mb-3">
          All wardrobe, fridge and planner data (including images) is stored locally in this browser via IndexedDB. It does not
          automatically sync across devices or browsers. Use export/import below to move it manually.
        </p>
        <div className="flex gap-2 mb-2">
          <Button variant="outline" onClick={handleExport}><Download size={15} /> Export backup (.json)</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import backup</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
        </div>
        <Button variant="danger" size="sm" onClick={handleReset}><Trash2 size={14} /> Reset all local data</Button>
      </section>

      {/* ---------------- Install / about ---------------- */}
      <section>
        <div className="flex items-center gap-2 mb-2"><Smartphone size={16} className="text-indigo-600" /><h3 className="font-semibold text-slate-800 text-sm">Install & about</h3></div>
        {installPromptEvent && <Button variant="outline" className="mb-3" onClick={handleInstall}>Install app to home screen</Button>}
        <Card className="p-3 text-xs text-slate-500 flex gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            Barcode lookups use the free Open Food Facts database. Smart Shopping uses free OpenStreetMap-based services (Photon geocoding, OSRM routing,
            Overpass place search) via their public low-volume endpoints — availability and accuracy are best-effort. Google Calendar / Microsoft Graph sync
            require your own OAuth app registration and are not pre-connected in this prototype; use .ics import/export as the reliable fallback.
          </span>
        </Card>
      </section>
    </Sheet>
  );
}
