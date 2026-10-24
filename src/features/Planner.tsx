// ---------------------------------------------------------------------------
// Planner area: Schedule, To Do List and Task Grouping (incl. Smart Shopping).
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
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
import type { CalendarEvent, Task, TaskPriority, Recurrence, ShoppingItem, StoreCandidate, GeoPoint, TravelMode } from '../types';
import { newId, nowIso } from '../types';
import { formatDate, formatDateTime, formatRelativeDays, daysUntil } from '../lib';
import { detectClashes, expandEventOccurrences, eventsToIcs, icsToEvents, groupTasks, filterStoresNearRoute, allocateItemsToStores } from '../services';
import { classifyTaskLocal, classifyTaskWithGemini, isGeminiConfigured } from '../ai';
import { geocode, calculateRoute, findSupermarketsNearRoute, type GeocodeResult } from '../geo';

type PlannerTab = 'schedule' | 'todo' | 'grouping';

export default function Planner() {
  const [tab, setTab] = useState<PlannerTab>('schedule');
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
      {tab === 'grouping' && <GroupingTab />}
    </div>
  );
}

// =============================== SCHEDULE =========================================

function ScheduleTab() {
  const { calendarEvents, importEvents, pushToast } = useApp();
  const [editing, setEditing] = useState<CalendarEvent | 'new' | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const rangeStart = useMemo(() => new Date(), []);
  const rangeEnd = useMemo(() => new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), []);
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
      await importEvents(events);
      pushToast(`Imported ${events.length} event(s)`, 'success');
    } catch {
      pushToast('Could not read that .ics file', 'error');
    }
  }

  return (
    <div className="px-4">
      <div className="flex gap-2 mb-3">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import .ics</Button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
        <Button size="sm" variant="outline" onClick={handleExport}><Download size={14} /> Export .ics</Button>
      </div>
      <p className="text-xs text-slate-400 mb-3">This planner supplements your existing calendar via manual entry and standard .ics import/export. Google Calendar / Outlook sync requires OAuth setup described in Settings and is not pre-connected.</p>

      {clashes.length > 0 && (
        <div className="bg-amber-50 text-amber-800 text-xs rounded-xl p-3 mb-3 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{clashes.length} scheduling clash(es) detected in the next 30 days — clashing events are marked below.</span>
        </div>
      )}

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
                <p className="text-xs text-slate-400">{formatDateTime(occ.start.toISOString())} – {occ.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{occ.event.location ? ` · ${occ.event.location}` : ''}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={occ.event.category === 'class' ? 'indigo' : occ.event.category === 'assignment' ? 'rose' : 'slate'}>{occ.event.category}</Badge>
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
    </div>
  );
}

function EventEditorSheet({ value, onClose }: { value: CalendarEvent | null; onClose: () => void }) {
  const { addCalendarEvent, updateCalendarEvent, deleteCalendarEvent, pushToast } = useApp();
  const confirm = useConfirm();
  const [title, setTitle] = useState(value?.title ?? '');
  const [location, setLocation] = useState(value?.location ?? '');
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
      location: location || undefined,
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
                    {t.location && <span className="text-[11px] text-slate-400 flex items-center gap-0.5"><MapPin size={10} /> {t.location}</span>}
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
  const { addTask, updateTask, deleteTask, pushToast } = useApp();
  const confirm = useConfirm();
  const [title, setTitle] = useState(value?.title ?? '');
  const [description, setDescription] = useState(value?.description ?? '');
  const [category, setCategory] = useState(value?.category ?? 'general');
  const [dueAt, setDueAt] = useState(value?.dueAt ? toLocalInput(value.dueAt) : '');
  const [location, setLocation] = useState(value?.location ?? '');
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
      location: location || undefined,
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

function GroupingTab() {
  const { tasks, calendarEvents } = useApp();
  const [smartShoppingOpen, setSmartShoppingOpen] = useState(false);
  const groups = useMemo(() => groupTasks(tasks, calendarEvents), [tasks, calendarEvents]);

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
const pinIcon = (color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 14]
  });

function SmartShoppingSheet({ onClose }: { onClose: () => void }) {
  const { shoppingItems, updateShoppingItem, settings, preferences, pushToast } = useApp();
  const [startQuery, setStartQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [travelMode, setTravelMode] = useState<TravelMode>(preferences.defaultTravelMode);
  const [deadline, setDeadline] = useState('');
  const [corridor, setCorridor] = useState(600);
  const [stage, setStage] = useState<'form' | 'loading' | 'results'>('form');
  const [statusMsg, setStatusMsg] = useState('');
  const [start, setStart] = useState<GeoPoint | null>(null);
  const [destination, setDestination] = useState<GeoPoint | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<GeoPoint[]>([]);
  const [routeDistanceM, setRouteDistanceM] = useState(0);
  const [stores, setStores] = useState<StoreCandidate[]>([]);
  const [allocation, setAllocation] = useState<Record<string, string[]>>({});

  const pendingItems = shoppingItems.filter((i) => !i.purchased);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set(pendingItems.map((i) => i.id)));

  async function geocodeOne(query: string, label: string): Promise<GeoPoint | null> {
    const result = await geocode(query);
    if (result.status !== 'ok' || result.data.length === 0) {
      pushToast(`Could not find "${query}" (${label}). Try a more specific address, or a nearby landmark.`, 'error');
      return null;
    }
    return result.data[0].point;
  }

  async function runPlan() {
    if (!startQuery.trim() || !destQuery.trim()) {
      pushToast('Enter both a start and a destination', 'error');
      return;
    }
    setStage('loading');
    setStatusMsg('Finding start location…');
    const startPt = await geocodeOne(startQuery, 'start');
    if (!startPt) { setStage('form'); return; }
    setStatusMsg('Finding destination…');
    const destPt = await geocodeOne(destQuery, 'destination');
    if (!destPt) { setStage('form'); return; }
    setStart(startPt);
    setDestination(destPt);

    setStatusMsg('Calculating route (OSRM)…');
    const route = await calculateRoute(startPt, destPt, travelMode);
    if (route.status !== 'ok') {
      pushToast(route.message, 'error');
      setStage('form');
      return;
    }
    setRouteGeometry(route.data.geometry);
    setRouteDistanceM(route.data.distanceMeters);

    setStatusMsg('Finding supermarkets near the route (Overpass / OpenStreetMap)…');
    const found = await findSupermarketsNearRoute(route.data.geometry, corridor);
    if (found.status !== 'ok') {
      pushToast(found.message, 'error');
      setStage('form');
      return;
    }
    const nearRoute = filterStoresNearRoute(found.data, route.data.geometry, corridor);
    if (nearRoute.length === 0) {
      pushToast('No supermarkets found within the corridor of this route. Try widening the corridor or adjusting the route.', 'info');
    }
    setStores(nearRoute);
    const itemsToAllocate = pendingItems.filter((i) => selectedItemIds.has(i.id));
    setAllocation(allocateItemsToStores(itemsToAllocate, nearRoute, 2, 12));
    setStage('results');
  }

  function moveItem(itemId: string, toStoreId: string) {
    setAllocation((prev) => {
      const next: Record<string, string[]> = {};
      for (const [storeId, ids] of Object.entries(prev)) next[storeId] = ids.filter((id) => id !== itemId);
      next[toStoreId] = [...(next[toStoreId] ?? []), itemId];
      return next;
    });
  }

  async function confirmPlan() {
    for (const [storeId, ids] of Object.entries(allocation)) {
      for (const id of ids) await updateShoppingItem(id, { assignedShopId: storeId });
    }
    pushToast('Shopping stops assigned — items now show which stop to buy them at.', 'success');
    onClose();
  }

  const center: [number, number] = start ? [start.lat, start.lon] : [51.505, -0.09];

  return (
    <Sheet open onClose={onClose} title="Smart Shopping" wide footer={stage === 'results' ? <Button onClick={confirmPlan}>Confirm allocation</Button> : undefined}>
      {stage === 'form' && (
        <div>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Start location"><TextInput value={startQuery} onChange={(e) => setStartQuery(e.target.value)} placeholder="e.g. your dorm address" /></Field>
            <Field label="Destination"><TextInput value={destQuery} onChange={(e) => setDestQuery(e.target.value)} placeholder="e.g. campus library" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Travel mode">
              <Select value={travelMode} onChange={(e) => setTravelMode(e.target.value as TravelMode)}>
                <option value="walking">Walking</option><option value="cycling">Cycling</option><option value="driving">Driving</option>
                <option value="public-transport">Public transport (routed as walking — OSRM has no transit profile)</option>
              </Select>
            </Field>
            <Field label="Shopping deadline (optional)"><TextInput type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          </div>
          <Field label={`Search corridor: ${corridor}m from route`} hint="How far off your route a store can be and still count as 'on the way'.">
            <input type="range" min={200} max={1500} step={100} value={corridor} onChange={(e) => setCorridor(Number(e.target.value))} className="w-full" />
          </Field>
          <p className="text-sm font-medium text-slate-700 mb-2 mt-2">Items to shop for</p>
          {pendingItems.length === 0 ? (
            <p className="text-xs text-slate-400 mb-3">Your shopping list is empty — add items in the Fridge tab first.</p>
          ) : (
            <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
              {pendingItems.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => setSelectedItemIds((s) => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })} />
                  {item.name} <span className="text-slate-400 text-xs">({item.quantity} {item.unit})</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mb-3">Uses free OpenStreetMap-based services (Photon geocoding, OSRM routing, Overpass place search) with public low-volume endpoints — results and availability are best-effort, not guaranteed stock or pricing.</p>
          <Button onClick={runPlan} disabled={pendingItems.length === 0}><Wand2 size={16} /> Plan route & find stops</Button>
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
          <div className="h-64 rounded-xl overflow-hidden mb-3 border border-slate-200">
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {routeGeometry.length > 0 && <Polyline positions={routeGeometry.map((p) => [p.lat, p.lon])} pathOptions={{ color: '#4f46e5', weight: 4 }} />}
              {start && <Marker position={[start.lat, start.lon]} icon={pinIcon('#16a34a')}><Popup>Start</Popup></Marker>}
              {destination && <Marker position={[destination.lat, destination.lon]} icon={pinIcon('#dc2626')}><Popup>Destination</Popup></Marker>}
              {stores.map((s) => (
                <Marker key={s.id} position={[s.point.lat, s.point.lon]} icon={storeIcon('#4f46e5')}>
                  <Popup>{s.name}<br />{Math.round(s.distanceFromRouteMeters)}m from route</Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">Map data &copy; OpenStreetMap contributors · Route: {(routeDistanceM / 1000).toFixed(1)}km via OSRM (public demo server, low-volume prototyping only).</p>

          {stores.length === 0 ? (
            <EmptyState icon={<ShoppingCart size={22} />} title="No stores found near this route" description="Try widening the corridor or choosing a different start/destination." />
          ) : (
            <div className="space-y-3">
              {stores.slice(0, 2).map((store) => {
                const assignedIds = allocation[store.id] ?? [];
                return (
                  <Card key={store.id} className="p-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-slate-800">{store.name}</p>
                      <Badge tone="indigo">{Math.round(store.distanceFromRouteMeters)}m off-route</Badge>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">{store.osmTags.shop ? `OSM shop=${store.osmTags.shop}` : 'OpenStreetMap place'}</p>
                    {assignedIds.length === 0 ? (
                      <p className="text-xs text-slate-400">No items assigned to this stop.</p>
                    ) : (
                      <div className="space-y-1">
                        {assignedIds.map((id) => {
                          const item = pendingItems.find((i) => i.id === id);
                          if (!item) return null;
                          const otherStore = stores.find((s) => s.id !== store.id);
                          return (
                            <div key={id} className="flex items-center justify-between text-sm">
                              <span>{item.name}</span>
                              {otherStore && <button className="text-xs text-indigo-600" onClick={() => moveItem(id, otherStore.id)}>Move to {otherStore.name.slice(0, 16)}…</button>}
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
          <p className="text-xs text-slate-400 mt-3">Prices and live stock are not available from OpenStreetMap — this plan optimises for route detour and convenience only. Edit the allocation above before confirming.</p>
        </div>
      )}
    </Sheet>
  );
}
