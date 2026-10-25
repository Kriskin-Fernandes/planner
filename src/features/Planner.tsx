// ---------------------------------------------------------------------------
// Planner area: Schedule, To Do List and Task Grouping (incl. Smart Shopping).
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Calendar, Plus, Trash2, AlertTriangle, Repeat, Bell, Upload, Download, MapPin, CheckSquare,
  Square, Sparkles, Cpu, ListChecks, Layers, ShoppingCart, Navigation, Loader2, X, Wand2
} from 'lucide-react';
import { useApp } from '../context';
import {
  Button, IconButton, Card, Badge, TabBar, SectionHeader, EmptyState, Sheet, Field, TextInput,
  TextArea, Select, Toggle, useConfirm, Spinner
} from '../components';
import { TASK_PRIORITY_LABELS, TASK_PRIORITY_COLORS } from '../data';
import type { CalendarEvent, Task, TaskPriority, Recurrence, ShoppingItem, StoreCandidate, GeoPoint } from '../types';
import { newId, nowIso } from '../types';
import { formatDate, formatDateTime, formatRelativeDays, daysUntil } from '../lib';
import { detectClashes, expandEventOccurrences, eventsToIcs, icsToEvents, groupTasks, filterStoresNearRoute } from '../services';
import { classifyTaskLocal, classifyTaskWithGemini, isGeminiConfigured } from '../ai';
import { geocode, findSupermarketsNearRoute, getTransitWalkingSegments, type GeocodeResult } from '../geo';
import { compareUkBasket, getCatalogueExpansion, type BasketRetailerTotal } from '../prices';

type PlannerTab = 'schedule' | 'todo' | 'grouping';

export default function Planner({ shoppingRequest = 0 }: { shoppingRequest?: number }) {
  const [tab, setTab] = useState<PlannerTab>('schedule');
  useEffect(() => { if (shoppingRequest > 0) setTab('grouping'); }, [shoppingRequest]);
  return (
    <div className="pb-28">
      <TabBar
        tabs={[
          { key: 'schedule', label: 'Schedule' },
          { key: 'todo', label: 'To Do List' },
          { key: 'grouping', label: 'Task Grouping' }
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'todo' && <TodoTab />}
      {tab === 'grouping' && <GroupingTab shoppingRequest={shoppingRequest} />}
    </div>
  );
}

// =============================== SCHEDULE =========================================

function ScheduleTab() {
  const { calendarEvents, importEvents, preferences, updatePreferences, pushToast } = useApp();
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null);
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month'>('month');
  const [importBatch, setImportBatch] = useState<CalendarEvent[] | null>(null);
  const [importTag, setImportTag] = useState('Uni');
  const [importLocation, setImportLocation] = useState(preferences.locationTags.Uni ?? 'Imperial College London');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const rangeStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); if (calendarView === 'week') d.setDate(d.getDate() - d.getDay()); if (calendarView === 'month') { d.setDate(1); d.setDate(d.getDate() - d.getDay()); } return d; }, [calendarView]);
  const rangeEnd = useMemo(() => new Date(rangeStart.getTime() + (calendarView === 'day' ? 1 : calendarView === 'week' ? 7 : 42) * 86400000), [rangeStart, calendarView]);
  const occurrences = useMemo(
    () =>
      calendarEvents
        .flatMap((e) => expandEventOccurrences(e, rangeStart, rangeEnd))
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [calendarEvents, rangeStart, rangeEnd]
  );
  const clashes = useMemo(() => detectClashes(calendarEvents, rangeStart, rangeEnd), [calendarEvents, rangeStart, rangeEnd]);
  const clashedEventIds = useMemo(() => new Set(clashes.flatMap((c) => [c.a.event.id, c.b.event.id])), [clashes]);

  function handleExport() {
    const ics = eventsToIcs(calendarEvents);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student-planner-events.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const events = icsToEvents(text);
      if (events.length === 0) {
        pushToast('No events found in that .ics file', 'error');
        return;
      }
      setImportBatch(events);
    } catch {
      pushToast('Could not read that .ics file', 'error');
    }
  }

  async function finishImport() {
    if (!importBatch) return;
    const tag = importTag.trim();
    const location = importLocation.trim();
    if (tag && location) await updatePreferences({ locationTags: { ...preferences.locationTags, [tag]: location } });
    const events = importBatch.map((event) => ({ ...event, locationTag: tag || undefined, location: location || event.location }));
    await importEvents(events);
    pushToast(`Imported ${events.length} event(s)${tag ? ` with the ${tag} location tag` : ''}`, 'success');
    setImportBatch(null);
  }

  return (
    <div className="px-4">
      <div className="flex gap-2 mb-3">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import .ics</Button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
        <Button size="sm" variant="outline" onClick={handleExport}><Download size={14} /> Export .ics</Button>
      </div>
      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 mb-3 w-fit">{(['day', 'week', 'month'] as const).map(v => <button key={v} onClick={() => setCalendarView(v)} className={`px-3 py-1.5 rounded-lg text-xs capitalize ${calendarView === v ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>{v}</button>)}</div>
      <p className="text-xs text-slate-400 mb-3">Manage your schedule here, or import and export events using .ics files.</p>

      {clashes.length > 0 && (
        <div className="bg-amber-50 text-amber-800 text-xs rounded-xl p-3 mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{clashes.length} scheduling clash(es) detected in the next 30 days — clashing events are marked below.</span>
        </div>
      )}

      {calendarView !== 'day' && <div className="grid grid-cols-7 gap-1 mb-3">
        {calendarView === 'month' && ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="text-center text-[10px] text-slate-400 py-1">{d}</div>)}
        {Array.from({ length: calendarView === 'week' ? 7 : 42 }, (_, i) => { const date = new Date(rangeStart); date.setDate(date.getDate() + i); const dayEvents = occurrences.filter(o => o.start.toDateString() === date.toDateString()); return <button key={i} onClick={() => setCalendarView('day')} className="min-h-16 rounded-lg border border-slate-100 bg-white p-1 text-left"><span className="text-[10px] text-slate-500">{date.getDate()}</span>{dayEvents.slice(0, 2).map((o, n) => <span key={n} className="block truncate rounded bg-indigo-50 px-1 text-[9px] text-indigo-700">{o.event.title}</span>)}</button>; })}
      </div>}
      {occurrences.length === 0 ? (
        <EmptyState icon={<Calendar size={24} />} title="No upcoming events" description="Add classes, assignments or personal commitments." action={<Button onClick={() => setEditing('new')}><Plus size={16} /> Add event</Button>} />
      ) : (
        <div className="space-y-2">
          {occurrences.map((occ, i) => (
            <Card key={`${occ.event.id}-${i}`} onClick={() => setEditing(occ.event)} className="p-3.5 flex items-center gap-3">
              <div className={`h-11 w-11 rounded-xl flex flex-col items-center justify-center shrink-0 ${clashedEventIds.has(occ.event.id) ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>
                <span className="text-[10px] font-medium leading-none">{occ.start.toLocaleDateString(undefined, { month: 'short' })}</span>
                <span className="text-sm font-bold leading-none mt-0.5">{occ.start.getDate()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate flex items-center gap-1.5">
                  {occ.event.title}
                  {clashedEventIds.has(occ.event.id) && <AlertTriangle size={13} className="text-amber-600 shrink-0" />}
                </p>
                <p className="text-xs text-slate-400">{formatDateTime(occ.start.toISOString())} – {occ.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{occ.event.location ? <> · <a onClick={(e) => e.stopPropagation()} className="text-indigo-600 underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(occ.event.location)}`}>{occ.event.location}</a></> : ''}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {occ.event.location ? <a onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(occ.event.location)}`}><Badge tone={occ.event.category === 'class' ? 'indigo' : occ.event.category === 'assignment' ? 'rose' : 'slate'}>{occ.event.category} · map</Badge></a> : <Badge tone={occ.event.category === 'class' ? 'indigo' : occ.event.category === 'assignment' ? 'rose' : 'slate'}>{occ.event.category}</Badge>}
                {occ.event.recurrence.freq !== 'none' && <Repeat size={12} className="text-slate-400" />}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-20">
        <Button size="lg" ariaLabel="Add event" className="rounded-full shadow-lg h-14 w-14 !px-0" onClick={() => setEditing('new')}><Plus size={24} /></Button>
      </div>

      {editing && <EventEditorSheet value={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importBatch && <Sheet open onClose={() => setImportBatch(null)} title="Add a location tag to this import" footer={<Button onClick={finishImport}>Import {importBatch.length} events</Button>}>
        <p className="text-sm text-slate-600 mb-3">Apply one location tag to every event in this calendar file, or leave the tag blank to keep each event’s original location.</p>
        <Field label="Location tag"><TextInput value={importTag} onChange={(e) => { setImportTag(e.target.value); setImportLocation(preferences.locationTags[e.target.value] ?? ''); }} placeholder="e.g. Uni" /></Field>
        <Field label="Place on Google Maps"><TextInput value={importLocation} onChange={(e) => setImportLocation(e.target.value)} placeholder="Imperial College London" /></Field>
        <div className="flex flex-wrap gap-2">{Object.entries(preferences.locationTags).map(([tag, place]) => <button key={tag} onClick={() => { setImportTag(tag); setImportLocation(place); }} className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700">{tag} · {place}</button>)}</div>
      </Sheet>}
    </div>
  );
}

function EventEditorSheet({ value, onClose }: { value: CalendarEvent | null; onClose: () => void }) {
  const { addCalendarEvent, updateCalendarEvent, deleteCalendarEvent, preferences, pushToast } = useApp();
  const confirm = useConfirm();
  const [title, setTitle] = useState(value?.title ?? '');
  const [location, setLocation] = useState(value?.location ?? '');
  const [locationTag, setLocationTag] = useState(value?.locationTag ?? '');
  const [description, setDescription] = useState(value?.description ?? '');
  const [start, setStart] = useState(value ? toLocalInput(value.start) : toLocalInput(nowIso()));
  const [end, setEnd] = useState(value ? toLocalInput(value.end) : toLocalInput(new Date(Date.now() + 3600000).toISOString()));
  const [category, setCategory] = useState<CalendarEvent['category']>(value?.category ?? 'other');
  const [freq, setFreq] = useState<Recurrence['freq']>(value?.recurrence.freq ?? 'none');
  const [reminderMins, setReminderMins] = useState<number>(value?.reminderMinutesBefore[0] ?? 15);

  async function save() {
    if (!title.trim()) {
      pushToast('Enter a title', 'error');
      return;
    }
    const base = {
      title: title.trim(),
      location: location || (locationTag ? preferences.locationTags[locationTag] : undefined),
      locationTag: locationTag || undefined,
      description: description || undefined,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      allDay: false,
      category,
      recurrence: { freq, interval: 1 } as Recurrence,
      reminderMinutesBefore: reminderMins > 0 ? [reminderMins] : [],
      externalSource: 'local' as const,
      updatedAt: nowIso()
    };
    if (value) {
      await updateCalendarEvent(value.id, base);
      pushToast('Event updated', 'success');
    } else {
      await addCalendarEvent({ id: newId(), ...base, createdAt: nowIso() });
      pushToast('Event added', 'success');
    }
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={value ? 'Edit event' : 'New event'}
      footer={
        <div className="flex w-full justify-between">
          {value ? (
            <Button variant="danger" onClick={async () => { if (await confirm.ask('Delete this event?')) { await deleteCalendarEvent(value.id); onClose(); } }}><Trash2 size={15} /></Button>
          ) : <span />}
          <Button onClick={save}>Save</Button>
        </div>
      }
    >
      {confirm.node}
      <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Linear Algebra Lecture" /></Field>
      <Field label="Location (optional)"><TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Maths Building, Room 204" /></Field>
      <Field label="Location tag (optional)"><Select value={locationTag} onChange={(e) => { setLocationTag(e.target.value); if (e.target.value) setLocation(preferences.locationTags[e.target.value] ?? ''); }}><option value="">No tag</option>{Object.keys(preferences.locationTags).map((tag) => <option key={tag} value={tag}>{tag}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts"><TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ends"><TextInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as any)}>
            <option value="class">Class</option><option value="assignment">Assignment</option><option value="personal">Personal</option><option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Repeats">
          <Select value={freq} onChange={(e) => setFreq(e.target.value as any)}>
            <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </Select>
        </Field>
      </div>
      <Field label="Reminder" hint="Shown in-app, plus a browser notification if permission is granted. Requires this tab to stay open.">
        <Select value={reminderMins} onChange={(e) => setReminderMins(Number(e.target.value))}>
          <option value={0}>No reminder</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option>
        </Select>
      </Field>
      <Field label="Notes (optional)"><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Sheet>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =============================== TO DO LIST =========================================

function TodoTab() {
  const { tasks, toggleTaskComplete, deleteTask, settings } = useApp();
  const [quickText, setQuickText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const confirm = useConfirm();
  const { addTask, pushToast } = useApp();

  const filtered = useMemo(() => {
    let list = tasks;
    if (filter === 'open') list = list.filter((t) => !t.completed);
    if (filter === 'completed') list = list.filter((t) => t.completed);
    return [...list].sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [tasks, filter]);

  async function quickAdd() {
    if (!quickText.trim()) return;
    setAdding(true);
    let result = isGeminiConfigured()
      ? await classifyTaskWithGemini(quickText, settings.geminiModels.textModel)
      : classifyTaskLocal(quickText);
    if (result.status !== 'ok') result = classifyTaskLocal(quickText);
    setAdding(false);
    if (result.status !== 'ok') {
      pushToast('Could not parse that task — try the full editor instead', 'error');
      return;
    }
    const final = result.data;
    await addTask({
      id: newId(),
      title: final.title,
      category: final.category,
      dueAt: final.dueAt,
      location: final.location ?? undefined,
      priority: final.priority,
      recurrence: final.recurrence,
      completed: false,
      completedAt: null,
      reminderMinutesBefore: final.dueAt ? [30] : [],
      linkedShoppingItemIds: [],
      classificationSource: result.provider === 'gemini' ? 'ai-gemini' : 'ai-local',
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    pushToast(result.provider === 'gemini' ? 'Task added (understood with Gemini)' : 'Task added (parsed locally)', 'success');
    setQuickText('');
  }

  return (
    <div className="px-4 pb-24">
      {confirm.node}
      <div className="flex gap-2 mb-2">
        <TextInput
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
          placeholder="e.g. Submit essay tomorrow at 5pm, urgent"
        />
        <Button onClick={quickAdd} disabled={adding}>{adding ? <Spinner size={16} /> : <Plus size={16} />}</Button>
      </div>
      <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">
        {isGeminiConfigured() ? <Sparkles size={12} /> : <Cpu size={12} />}
        {isGeminiConfigured() ? ' Natural language understood with Gemini' : ' Natural language parsed on-device (dates, priority, location keywords)'} — review before relying on it.
      </p>

      <div className="flex gap-2 mb-3">
        {(['open', 'completed', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${filter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing('new')}>Full editor</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<ListChecks size={24} />} title="Nothing here" description="Add a task above, or use the full editor for more detail." />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const d = daysUntil(t.dueAt);
            return (
              <Card key={t.id} className="p-3 flex items-start gap-3">
                <button data-testid="task-checkbox" onClick={() => toggleTaskComplete(t.id)} className="mt-0.5 shrink-0 text-indigo-600">
                  {t.completed ? <CheckSquare size={20} /> : <Square size={20} className="text-slate-300" />}
                </button>
                <div className="flex-1 min-w-0" onClick={() => setEditing(t)}>
                  <p className={`text-sm font-medium ${t.completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>{t.title}</p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    {t.dueAt && <Badge tone={d !== null && d < 0 && !t.completed ? 'rose' : 'slate'}>{formatRelativeDays(d)}</Badge>}
                    <Badge tone="slate">{t.category}</Badge>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${TASK_PRIORITY_COLORS[t.priority]}`}>{TASK_PRIORITY_LABELS[t.priority]}</span>
                    {t.location && <a onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.location)}`} className="text-[11px] text-indigo-500 flex items-center gap-0.5"><MapPin size={10} /> {t.location}</a>}
                    {t.reminderMinutesBefore.length > 0 && <Bell size={11} className="text-slate-400" />}
                  </div>
                </div>
                <IconButton icon={<Trash2 size={14} />} label="Delete" onClick={async () => { if (await confirm.ask(`Delete "${t.title}"?`)) await deleteTask(t.id); }} />
              </Card>
            );
          })}
        </div>
      )}

      {editing && <TaskEditorSheet value={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskEditorSheet({ value, onClose }: { value: Task | null; onClose: () => void }) {
  const { addTask, updateTask, deleteTask, preferences, pushToast } = useApp();
  const confirm = useConfirm();
  const [title, setTitle] = useState(value?.title ?? '');
  const [description, setDescription] = useState(value?.description ?? '');
  const [category, setCategory] = useState(value?.category ?? 'general');
  const [dueAt, setDueAt] = useState(value?.dueAt ? toLocalInput(value.dueAt) : '');
  const [location, setLocation] = useState(value?.location ?? '');
  const [locationTag, setLocationTag] = useState(value?.locationTag ?? '');
  const [priority, setPriority] = useState<TaskPriority>(value?.priority ?? 'medium');
  const [freq, setFreq] = useState<Recurrence['freq']>(value?.recurrence.freq ?? 'none');
  const [reminderMins, setReminderMins] = useState<number>(value?.reminderMinutesBefore[0] ?? 0);

  async function save() {
    if (!title.trim()) {
      pushToast('Enter a title', 'error');
      return;
    }
    const base = {
      title: title.trim(),
      description: description || undefined,
      category,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      location: location || (locationTag ? preferences.locationTags[locationTag] : undefined),
      locationTag: locationTag || undefined,
      priority,
      recurrence: { freq, interval: 1 } as Recurrence,
      reminderMinutesBefore: reminderMins > 0 ? [reminderMins] : [],
      updatedAt: nowIso()
    };
    if (value) {
      await updateTask(value.id, base);
      pushToast('Task updated', 'success');
    } else {
      await addTask({
        id: newId(), ...base, completed: false, completedAt: null, linkedShoppingItemIds: [],
        classificationSource: 'user', createdAt: nowIso()
      });
      pushToast('Task added', 'success');
    }
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={value ? 'Edit task' : 'New task'}
      footer={
        <div className="flex w-full justify-between">
          {value ? <Button variant="danger" onClick={async () => { if (await confirm.ask('Delete this task?')) { await deleteTask(value.id); onClose(); } }}><Trash2 size={15} /></Button> : <span />}
          <Button onClick={save}>Save</Button>
        </div>
      }
    >
      {confirm.node}
      <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description (optional)"><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><TextInput value={category} onChange={(e) => setCategory(e.target.value)} placeholder="coursework, errand…" /></Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(TASK_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due (optional)"><TextInput type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        <Field label="Location (optional)"><TextInput value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Location tag (optional)"><Select value={locationTag} onChange={(e) => { setLocationTag(e.target.value); if (e.target.value) setLocation(preferences.locationTags[e.target.value] ?? ''); }}><option value="">No tag</option>{Object.keys(preferences.locationTags).map((tag) => <option key={tag} value={tag}>{tag}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeats">
          <Select value={freq} onChange={(e) => setFreq(e.target.value as any)}>
            <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Reminder">
          <Select value={reminderMins} onChange={(e) => setReminderMins(Number(e.target.value))}>
            <option value={0}>None</option><option value={30}>30 min before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option>
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

// =============================== TASK GROUPING + SMART SHOPPING =========================================

function GroupingTab({ shoppingRequest = 0 }: { shoppingRequest?: number }) {
  const { tasks, calendarEvents, preferences } = useApp();
  const [smartShoppingOpen, setSmartShoppingOpen] = useState(false);
  const handledShoppingRequest = useRef(0);
  useEffect(() => {
    if (shoppingRequest > 0 && handledShoppingRequest.current !== shoppingRequest) {
      handledShoppingRequest.current = shoppingRequest;
      setSmartShoppingOpen(true);
    }
  }, [shoppingRequest]);
  const groups = useMemo(() => groupTasks(tasks, calendarEvents, preferences.locationTags), [tasks, calendarEvents, preferences.locationTags]);

  return (
    <div className="px-4 pb-10">
      <Card className="p-4 mb-4 bg-gradient-to-br from-indigo-600 to-indigo-700 text-white border-0">
        <div className="flex items-center gap-2 mb-1"><ShoppingCart size={18} /><p className="font-semibold">Smart Shopping</p></div>
        <p className="text-sm text-indigo-100 mb-3">Plan a shopping stop along a real route, using live OpenStreetMap places — not a guess.</p>
        <Button variant="outline" className="!bg-white !text-indigo-700" onClick={() => setSmartShoppingOpen(true)}><Navigation size={15} /> Plan a route</Button>
      </Card>

      <SectionHeader title="Grouped open tasks" />
      {groups.length === 0 ? (
        <p className="text-sm text-slate-400 px-1 py-4">No open tasks to group right now.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.key} className="p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={14} className="text-indigo-500" />
                <p className="font-medium text-slate-800 text-sm">{g.label}</p>
                <Badge tone="slate">{g.tasks.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {g.tasks.map((t) => (
                  <div key={t.id} className="text-sm text-slate-600 flex items-center justify-between border-b border-slate-50 last:border-0 pb-1.5 last:pb-0">
                    <span>{t.title}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${TASK_PRIORITY_COLORS[t.priority]}`}>{TASK_PRIORITY_LABELS[t.priority]}</span>
                  </div>
                ))}
              </div>
              {g.relatedEvents.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1"><Calendar size={11} /> Linked to: {g.relatedEvents.map((e) => e.title).join(', ')}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {smartShoppingOpen && <SmartShoppingSheet onClose={() => setSmartShoppingOpen(false)} />}
    </div>
  );
}

const storeIcon = (color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

function compareCommonItems(totals: BasketRetailerTotal[]) {
  const complete = totals.filter((row) => row.matched === row.totalItems && row.totalItems > 0);
  if (complete.length < 2) return null;
  const itemIds = complete[0].pricedItems.map((line) => line.itemId);
  if (!itemIds.length || complete.some((row) => row.pricedItems.length !== itemIds.length)) return null;
  let best: { matched: number; cheaper: string; dearer: string; chains: string[]; saved: number; cheaperTotal: number; dearerTotal: number; splitTotal: number } | null = null;
  for (let i = 0; i < complete.length; i++) for (let j = i + 1; j < complete.length; j++) {
    const left = complete[i], right = complete[j];
    const splitTotal = itemIds.reduce((sum, id) => sum + Math.min(left.pricedItems.find((line) => line.itemId === id)!.price, right.pricedItems.find((line) => line.itemId === id)!.price), 0);
    const cheapest = left.total <= right.total ? left : right;
    const comparison = { matched: itemIds.length, cheaper: cheapest.retailer, dearer: left === cheapest ? right.retailer : left.retailer, chains: [left.retailer, right.retailer], saved: Math.max(0, cheapest.total - splitTotal), cheaperTotal: cheapest.total, dearerTotal: Math.max(left.total, right.total), splitTotal };
    if (!best || comparison.saved > best.saved) best = comparison;
  }
  return best;
}

function allocateByBestPrice(items: ShoppingItem[], stores: StoreCandidate[], totals: BasketRetailerTotal[], allowSplit: boolean) {
  const allocation: Record<string, string[]> = {};
  const candidates = allowSplit ? stores : [...stores].sort((a, b) => (storePriceRow(a, totals)?.total ?? Infinity) - (storePriceRow(b, totals)?.total ?? Infinity)).slice(0, 1);
  for (const item of items) {
    const ranked = candidates.map((store) => ({ store, line: storePriceRow(store, totals)?.pricedItems.find((row) => row.itemId === item.id) }))
      .filter((entry): entry is { store: StoreCandidate; line: NonNullable<ReturnType<typeof storePriceRow>>['pricedItems'][number] } => !!entry.line)
      .sort((a, b) => a.line.price - b.line.price);
    const chosen = ranked[0]?.store;
    if (chosen) allocation[chosen.id] = [...(allocation[chosen.id] ?? []), item.id];
  }
  return allocation;
}

const retailerKey = (name: string) => name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const isMainstreamStore = (name: string) => /tesco|asda|sainsbur|waitrose|aldi|lidl|morrisons|iceland|co-?op/i.test(name);
function storePriceRow(store: StoreCandidate, totals: BasketRetailerTotal[]) {
  const name = retailerKey(store.name);
  return totals.find((row) => {
    const chain = retailerKey(row.retailer);
    return chain.length >= 3 && name.includes(chain);
  });
}
const pinIcon = (color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14]
  });

function SmartShoppingSheet({ onClose }: { onClose: () => void }) {
  const { shoppingItems, updateShoppingItem, deleteShoppingItem, addShoppingItem, settings, preferences, pushToast } = useApp();
  const [startQuery, setStartQuery] = useState(settings.homeAddress || '69 Yeldham Road, W6 8JQ');
  const [destQuery, setDestQuery] = useState(preferences.locationTags.Uni || 'Imperial College London');
  const [deadline, setDeadline] = useState('');
  const [corridor, setCorridor] = useState(300);
  const [stage, setStage] = useState<'form' | 'loading' | 'results'>('form');
  const [statusMsg, setStatusMsg] = useState('');
  const [start, setStart] = useState<GeoPoint | null>(null);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<GeoPoint[][]>([]);
  const [routeDistanceM, setRouteDistanceM] = useState(0);
  const [stores, setStores] = useState<StoreCandidate[]>([]);
  const [nearbyAlternatives, setNearbyAlternatives] = useState<StoreCandidate[]>([]);
  const [allocation, setAllocation] = useState<Record<string, string[]>>({});
  const [plannedItems, setPlannedItems] = useState<ShoppingItem[]>([]);
  const [priceTotals, setPriceTotals] = useState<BasketRetailerTotal[]>([]);
  const [priceDate, setPriceDate] = useState<string | null>(null);
  const [priceMessage, setPriceMessage] = useState('');
  const [catalogueItems, setCatalogueItems] = useState<ShoppingItem[]>([]);
  const hasAutoStarted = useRef(false);

  const pendingItems = shoppingItems.filter((i) => !i.purchased);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set(pendingItems.map((i) => i.id)));
  const selectedBasketCount = pendingItems.filter((item) => selectedItemIds.has(item.id)).length;

  async function geocodeOne(query: string, label: string): Promise<GeoPoint | null> {
    const result = await geocode(query);
    if (result.status !== 'ok' || result.data.length === 0) {
      pushToast(`Could not find "${query}" (${label}). Try a more specific address, or a nearby landmark.`, 'error');
      return null;
    }
    return result.data[0].point;
  }

  async function runPlan() {
    if (!settings.googleMapsApiKey.trim()) { pushToast('Add a Google Maps Routes API key in Settings to find shops along actual walking sections.', 'error'); return; }
    if (!startQuery.trim() || !destQuery.trim()) { pushToast('Enter your home and university locations', 'error'); return; }
    const baseItems = pendingItems.filter((item) => selectedItemIds.has(item.id));
    if (!baseItems.length) { pushToast('Select at least one shopping item', 'info'); return; }
    setStage('loading');
    setPriceMessage('');
    setStores([]);
    setNearbyAlternatives([]);
    setStatusMsg('Reading Google Maps walking sections on the route back from uni…');
    const homePt = await geocodeOne(startQuery, 'home');
    if (!homePt) { setStage('form'); return; }
    const uniPt = await geocodeOne(destQuery, 'university');
    if (!uniPt) { setStage('form'); return; }
    const transitWalk = await getTransitWalkingSegments(uniPt, homePt, settings.googleMapsApiKey.trim());
    if (transitWalk.status !== 'ok') { pushToast(transitWalk.message, 'error'); setStage('form'); return; }
    setStart(uniPt);
    setDestination(homePt);
    setRouteGeometry(transitWalk.data.segments);
    setRouteDistanceM(transitWalk.data.walkingDistanceMeters);

    setStatusMsg('Finding shops within walking distance of the return-route walking sections…');
    const segmentResults: Awaited<ReturnType<typeof findSupermarketsNearRoute>>[] = [];
    for (const segment of transitWalk.data.segments) segmentResults.push(await findSupermarketsNearRoute(segment, corridor, settings.googleMapsApiKey.trim()));
    const routeError = segmentResults.find((result) => result.status !== 'ok');
    if (routeError?.status === 'error') { pushToast(routeError.message, 'error'); setStage('form'); return; }
    const candidateMap = new Map<string, StoreCandidate>();
    for (let i = 0; i < segmentResults.length; i++) {
      const result = segmentResults[i];
      if (result.status !== 'ok') continue;
      for (const store of filterStoresNearRoute(result.data, transitWalk.data.segments[i], corridor)) {
        const previous = candidateMap.get(store.id);
        if (!previous || store.distanceFromRouteMeters < previous.distanceFromRouteMeters) candidateMap.set(store.id, store);
      }
    }
    const nearWalkingRoute = [...candidateMap.values()].sort((a, b) => a.distanceFromRouteMeters - b.distanceFromRouteMeters);
    setStatusMsg('Comparing today’s UK supermarket prices…');
    try {
      let itemsToAllocate = [...baseItems];
      let comparison = await compareUkBasket(itemsToAllocate);
      let saving = compareCommonItems(comparison.totals);
      const extras: ShoppingItem[] = [];
      if (!saving || saving.saved < 0.01) {
        setStatusMsg('Broadening the basket with comparable groceries from the live price catalogue…');
        const catalogue = await getCatalogueExpansion(baseItems);
        let bestScore = comparison.totals.filter((row) => row.matched === itemsToAllocate.length).length * 100000 + (saving?.saved ?? 0);
        for (const candidate of catalogue) {
          const trialItems = [...itemsToAllocate, candidate];
          const trial = await compareUkBasket(trialItems);
          const trialComplete = trial.totals.filter((row) => row.matched === trialItems.length);
          const trialSaving = compareCommonItems(trial.totals);
          const score = trialComplete.length * 100000 + (trialSaving?.saved ?? 0);
          if (score > bestScore + 0.009) {
            extras.push(candidate);
            itemsToAllocate = trialItems;
            comparison = trial;
            saving = trialSaving;
            bestScore = score;
          }
          if (saving?.saved && saving.saved >= 0.01) break;
        }
      }
      setCatalogueItems(extras);
      setPlannedItems(itemsToAllocate);
      const completeBaskets = comparison.totals.filter((row) => row.matched === itemsToAllocate.length);
      const matchedStores = nearWalkingRoute.filter((store) => storePriceRow(store, completeBaskets));
      const seenChains = new Set<string>();
      const oneBranchPerChain = matchedStores.filter((store) => {
        const chain = retailerKey(storePriceRow(store, completeBaskets)?.retailer ?? store.name);
        if (seenChains.has(chain)) return false;
        seenChains.add(chain);
        return true;
      });
      const routeTotals = completeBaskets.filter((row) => oneBranchPerChain.some((store) => retailerKey(storePriceRow(store, completeBaskets)?.retailer ?? '') === retailerKey(row.retailer)));
      saving = compareCommonItems(routeTotals);
      const savingsFound = !!saving && saving.saved >= 0.01;
      const targetChains = savingsFound ? saving!.chains.map(retailerKey) : [...routeTotals].sort((a, b) => a.total - b.total).slice(0, 1).map((row) => retailerKey(row.retailer));
      const completeWalkingStores = oneBranchPerChain.filter((store) => targetChains.includes(retailerKey(storePriceRow(store, routeTotals)?.retailer ?? '')));
      const selectedTotals = routeTotals.filter((row) => targetChains.includes(retailerKey(row.retailer)));
      setStores(completeWalkingStores);
      setNearbyAlternatives(!savingsFound ? nearWalkingRoute.filter((store) => !storePriceRow(store, completeBaskets) && !isMainstreamStore(store.name)).slice(0, 12) : []);
      setAllocation(allocateByBestPrice(itemsToAllocate, completeWalkingStores, selectedTotals, savingsFound));
      setPriceTotals(selectedTotals);
      setPriceDate(comparison.latestAt);
      for (const item of baseItems) {
        const price = comparison.priceByItem[item.id];
        if (price !== undefined) await updateShoppingItem(item.id, { estimatedPrice: price, priceSource: 'verified' });
        else await deleteShoppingItem(item.id);
      }
      if (extras.length) pushToast(`Added ${extras.length} comparable grocery ${extras.length === 1 ? 'item' : 'items'} from the price catalogue to find a better split.`, 'info');
      if (!savingsFound) setPriceMessage('No cheaper two-store split is available for this basket. The plan keeps your groceries at the lowest priced single chain.');
      if (!completeWalkingStores.length) setPriceMessage(`No nearby return-route shop has a complete ${itemsToAllocate.length}/${itemsToAllocate.length} match.`);
    } catch (error) {
      setStores([]);
      setAllocation({});
      setPriceTotals([]);
      setPriceMessage(error instanceof Error ? error.message : 'Grocery prices are temporarily unavailable.');
    }
    setStage('results');
  }

  useEffect(() => {
    if (hasAutoStarted.current) return;
    hasAutoStarted.current = true;
    void runPlan();
  }, []);

  function useIndependentStore(store: StoreCandidate) {
    setStores([store]);
    setAllocation({ [store.id]: plannedItems.map((item) => item.id) });
    setPriceTotals([]);
    setNearbyAlternatives([]);
    setPriceMessage('This nearby grocery shop has no item-level prices in the supermarket feed, so no price or savings claim is shown.');
  }

  async function confirmPlan() {
    const catalogueById = new Map(catalogueItems.map((item) => [item.id, item]));
    for (const [storeId, ids] of Object.entries(allocation)) {
      const store = stores.find((candidate) => candidate.id === storeId);
      if (!store) continue;
      for (const id of ids) {
        const patch = { assignedShopId: storeId, assignedShopName: store.name, assignedShopLocation: `${store.point.lat},${store.point.lon}` };
        const catalogueItem = catalogueById.get(id);
        if (catalogueItem) await addShoppingItem({ ...catalogueItem, ...patch, estimatedPrice: storePriceRow(store, priceTotals)?.pricedItems.find((line) => line.itemId === id)?.price ?? null, priceSource: 'verified' });
        else await updateShoppingItem(id, patch);
      }
    }
    pushToast(catalogueItems.length ? `Shopping stops assigned; ${catalogueItems.length} catalogue grocery ${catalogueItems.length === 1 ? 'item was' : 'items were'} added to your list.` : 'Shopping stops assigned — items now show which stop to buy them at.', 'success');
    onClose();
  }

  const center: [number, number] = start ? [start.lat, start.lon] : [51.505, -0.09];
  const savingsComparison = compareCommonItems(priceTotals);

  return (
    <Sheet open onClose={onClose} title="Smart Shopping" wide footer={stage === 'results' ? <Button onClick={confirmPlan}>Confirm allocation</Button> : undefined}>
      {stage === 'form' && (
        <div>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Home"><TextInput value={startQuery} onChange={(e) => setStartQuery(e.target.value)} placeholder="Home address" /></Field>
            <Field label="University"><TextInput value={destQuery} onChange={(e) => setDestQuery(e.target.value)} placeholder="Imperial College London" /></Field>
          </div>
          <p className="my-3 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-900">Smart Shop checks the trip from university back home and searches only within {corridor} m of Google Maps walking sections. Shops must have prices for every selected item.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Walking distance: ${corridor}m`} hint="Maximum distance from a walking segment.">
              <input type="range" min={100} max={500} step={50} value={corridor} onChange={(e) => setCorridor(Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Shopping deadline (optional)"><TextInput type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          </div>
          <p className="text-sm font-medium text-slate-700 mb-2 mt-2">Items to shop for</p>
          {pendingItems.length === 0 ? (
            <p className="text-xs text-slate-400 mb-3">Your shopping list is empty — add items in the Fridge tab first.</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {pendingItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => setSelectedItemIds((s) => { const n = new Set(s); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })} />
                  {item.name} <span className="text-slate-400 text-xs">({item.quantity} {item.unit})</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mb-3">Store prices are checked against the selected basket; nearby branches are discovered from Google Places and filtered against Google Maps walking legs.</p>
          <Button onClick={runPlan} disabled={pendingItems.length === 0}><Wand2 size={16} /> Find shops on this route</Button>
        </div>
      )}

      {stage === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-10 text-slate-500">
          <Spinner size={24} />
          <p className="text-sm">{statusMsg}</p>
        </div>
      )}

      {stage === 'results' && (
        <div>
            <Button variant="outline" className="mb-3" onClick={() => setStage('form')}>Change start or destination</Button>
            <div className="flex flex-wrap gap-2 mb-3">
              {(['transit', 'walking', 'bicycling', 'driving'] as const).map((mode) => <a key={mode} className="px-3 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-medium" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(destQuery)}&destination=${encodeURIComponent(startQuery)}&travelmode=${mode}`}>{mode === 'transit' ? 'Google Maps · Transit home' : `Google Maps · ${mode}`}</a>)}
            </div>
            <p className="text-xs text-slate-500 mb-3">The map shows only the walking steps of the Google Maps transit trip back from uni. Stores are shown only when the full selected basket is priced.</p>
          <Card className="p-4 mb-3 bg-emerald-50 border-emerald-100">
            <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold text-emerald-950">Supermarket price comparison</h3><p className="text-[11px] text-emerald-800">UK online shelf prices · latest listing {priceDate ? new Date(priceDate).toLocaleDateString() : 'available'} · matched products only</p></div><Badge tone="green">£ GBP</Badge></div>
            {priceTotals.length ? <div className="mt-3 space-y-2"><p className="text-xs font-semibold text-emerald-950">Store subtotals · matched items</p>{priceTotals.map((row) => <div key={row.retailer} className="flex items-center justify-between text-sm"><span className="capitalize font-medium text-slate-700">{row.retailer}</span><span className="text-slate-900">£{row.total.toFixed(2)} <span className="text-[11px] text-slate-500">({row.matched}/{row.totalItems} matched)</span></span></div>)}{savingsComparison && savingsComparison.saved >= 0.01 ? <div className="rounded-lg bg-white/70 p-2 text-xs font-semibold text-emerald-900">Two-store split across {savingsComparison.chains.join(' + ')}: £{savingsComparison.splitTotal.toFixed(2)} vs {savingsComparison.cheaper} at £{savingsComparison.cheaperTotal.toFixed(2)} · save £{savingsComparison.saved.toFixed(2)} after comparing each item. This split is only shown because it is cheaper.</div> : <div className="rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-900">{priceMessage || 'No cheaper split found; keep the whole basket at the lowest priced chain.'}</div>}{catalogueItems.length > 0 && <div className="rounded-lg bg-white/70 p-2 text-xs text-emerald-900"><span className="font-semibold">Expanded with comparable groceries:</span> {catalogueItems.map((item) => item.name).join(', ')}. These will be added to your shopping list when you confirm.</div>}<div className="flex justify-between text-xs text-emerald-900"><span>Service charge (in-store collection)</span><span>£0.00</span></div><p className="text-[10px] text-emerald-900 mt-2">Price data combines the <a className="underline" href="https://apify.com/yappman/uk-supermarket-price-scraper" target="_blank" rel="noreferrer">Yappman supermarket feed</a> with product listings from <a className="underline" href="https://www.waitrose.com/ecom/shop/browse/groceries" target="_blank" rel="noreferrer">Waitrose online</a>. Independent nearby shops are shown as route options when item-level prices are unavailable.</p></div> : <p className="text-xs text-emerald-900 mt-3">{priceMessage || 'No matching products in the price sources.'}</p>}
          </Card>
          <div className="h-64 rounded-xl overflow-hidden mb-3 border border-slate-200">
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {routeGeometry.map((segment, index) => <Polyline key={index} positions={segment.map((p) => [p.lat, p.lon])} pathOptions={{ color: '#4f46e5', weight: 4 }} />)}
              {start && <Marker position={[start.lat, start.lon]} icon={pinIcon('#16a34a')}><Popup>Start</Popup></Marker>}
              {destination && <Marker position={[destination.lat, destination.lon]} icon={pinIcon('#dc2626')}><Popup>Destination</Popup></Marker>}
              {stores.map((s) => (
                <Marker key={s.id} position={[s.point.lat, s.point.lon]} icon={storeIcon((allocation[s.id] ?? []).length ? '#ea580c' : '#4f46e5')}>
                  <Popup>{s.name}<br />{Math.round(s.distanceFromRouteMeters)}m from route</Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-3"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-orange-600" /> Selected shopping stop</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-indigo-600" /> Other matched store</span></div>
          <p className="text-[11px] text-slate-400 mb-3">Map data &copy; OpenStreetMap contributors · Google Maps walking sections total {(routeDistanceM / 1000).toFixed(1)}km.</p>

          {nearbyAlternatives.length > 0 && <Card className="p-3.5 mb-3 border-indigo-100 bg-indigo-50/50"><h3 className="text-sm font-semibold text-slate-800">Nearby independent groceries</h3><p className="text-xs text-slate-500 mt-1 mb-2">No cheaper fully priced mainstream split was found. These local grocery stops are on the walking route; their prices are not in the comparison feed.</p><div className="space-y-2">{nearbyAlternatives.map((store) => <div key={store.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><div><p className="text-sm font-medium text-slate-700">{store.name}</p><p className="text-xs text-slate-400">{Math.round(store.distanceFromRouteMeters)}m from walking route · price unavailable</p></div><Button variant="outline" onClick={() => useIndependentStore(store)}>Plan this stop</Button></div>)}</div></Card>}

          {stores.length === 0 ? (
            <EmptyState icon={<ShoppingCart size={22} />} title={`No complete ${selectedBasketCount}/${selectedBasketCount} shops on the walking route`} description="Only stores with a price match for every selected item are shown." />
          ) : (
            <div className="space-y-3">
                      {stores.slice(0, 2).map((store) => {
                const assignedIds = allocation[store.id] ?? [];
                        const storeQuote = storePriceRow(store, priceTotals);
                        const assignedSubtotal = assignedIds.reduce((sum, id) => sum + (storeQuote?.pricedItems.find((line) => line.itemId === id)?.price ?? 0), 0);
                return (
                  <Card key={store.id} className="p-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-slate-800">{store.name}</p>
                      <Badge tone={storeQuote ? 'green' : 'slate'}>{storeQuote ? `${storeQuote.matched}/${storeQuote.totalItems} priced` : 'Price unavailable'} · {Math.round(store.distanceFromRouteMeters)}m walk</Badge>
                    </div>
                    <p className="text-xs font-semibold text-emerald-800 mb-2">{storeQuote ? `Store subtotal · £${assignedSubtotal.toFixed(2)}` : 'Item prices are unavailable for this store'}</p>
                    <p className="text-xs text-slate-400 mb-2">{store.osmTags.provider === 'Google Places' ? 'Google Places location · price checked against the available store catalogue' : 'OpenStreetMap directory fallback · price checked against the available store catalogue'}</p>
                    {assignedIds.length === 0 ? (
                      <p className="text-xs text-slate-400">No items assigned to this stop.</p>
                    ) : (
                      <div className="space-y-1">
                        {assignedIds.map((id) => {
                          const item = [...pendingItems, ...catalogueItems].find((i) => i.id === id);
                          if (!item) return null;
                          return (
                            <div key={id} className="flex items-center justify-between text-sm">
                          <span>{item.name}{storeQuote?.pricedItems.find((line) => line.itemId === id) && <> · £{storeQuote.pricedItems.find((line) => line.itemId === id)!.price.toFixed(2)}</>}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-3">All shown shops price the complete basket and sit within walking distance of a return-route walking leg. Confirm allocation to add each stop to Today’s agenda.</p>
        </div>
      )}
    </Sheet>
  );
}
