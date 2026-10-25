import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Navigation, Shirt, Wind, Droplets } from 'lucide-react';
import { useApp } from '../context';
import { Button, Card, Badge, BlobImage } from '../components';
import { recommendOutfits } from '../services';
import { geocode } from '../geo';
import type { GeoPoint } from '../types';

export default function Home({ openPlanner }: { openPlanner: () => void }) {
  const { tasks, calendarEvents, garments, shoppingItems, settings, preferences } = useApp();
  const [weather, setWeather] = useState<any>(null);
  const [weatherError, setWeatherError] = useState('');
  const today = new Date();
  const dayTasks = useMemo(() => tasks.filter(t => !t.completed && (t.recurrence.freq === 'daily' || (t.dueAt && new Date(t.dueAt).toDateString() === today.toDateString()))), [tasks]);
  const todayEvents = useMemo(() => calendarEvents.filter(e => new Date(e.start).toDateString() === today.toDateString()), [calendarEvents]);
  const recommendation = useMemo(() => recommendOutfits(garments, {
    weatherTempC: weather?.current?.temperature_2m,
    precipitationChance: weather?.current?.precipitation > 0 ? 0.7 : 0.1,
    maxResults: 1
  })[0], [garments, weather]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!settings.homeAddress.trim()) { setWeatherError('Add your home address in Settings to see local weather.'); return; }
      setWeatherError('');
      try {
        const geo = await geocode(settings.homeAddress);
        if (geo.status !== 'ok' || !geo.data[0]) throw new Error('We could not match that address. Add a town or postcode in Settings.');
        const point: GeoPoint = geo.data[0].point;
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=precipitation,precipitation_probability&forecast_days=1&timezone=auto`);
        if (!response.ok) throw new Error(`Weather provider returned HTTP ${response.status}`);
        const data = await response.json();
        if (active) setWeather(data);
      } catch (error) { if (active) setWeatherError(error instanceof Error ? error.message : 'Weather is temporarily unavailable.'); }
    })();
    return () => { active = false; };
  }, [settings.homeAddress]);

  const current = weather?.current;
  const rainEntries: Array<{ time: string; amount: number; probability: number }> = (weather?.hourly?.time ?? []).map((time: string, i: number) => ({ time, amount: Number(weather.hourly.precipitation?.[i] ?? 0), probability: Number(weather.hourly.precipitation_probability?.[i] ?? 0) })).filter((hour: { amount: number; probability: number }) => hour.amount >= 0.2 || hour.probability >= 40);
  const rainWindow = rainEntries.length ? `${rainEntries[0].amount < 1 ? 'Light' : 'Rain'} rainfall ${new Date(rainEntries[0].time).toLocaleTimeString([], { hour: 'numeric' })}–${new Date(rainEntries[rainEntries.length - 1].time).toLocaleTimeString([], { hour: 'numeric' })}` : 'No rain expected';
  const weatherDescription = (code: number) => code === 0 ? 'Clear sky' : code <= 2 ? 'Partly cloudy' : code === 3 ? 'Overcast' : code < 50 ? 'Foggy' : code < 60 ? 'Drizzle' : code < 70 ? 'Rain' : code < 80 ? 'Snow' : 'Showers';
  const weatherIcon = (code: number) => code === 0 ? '☀️' : code <= 2 ? '🌤️' : code === 3 ? '☁️' : code < 70 ? '🌧️' : '🌨️';

  const uniPlace = preferences.locationTags.Uni || 'Imperial College London';
  const taskPlace = (task: typeof dayTasks[number]) => task.location || (task.locationTag ? preferences.locationTags[task.locationTag] : '');
  const eventPlace = (event: typeof todayEvents[number]) => event.location || (event.locationTag ? preferences.locationTags[event.locationTag] : '');
  const samePlace = (left: string, right: string) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  const assignmentTasks = dayTasks.filter(task => task.category === 'coursework');
  const generalTasks = dayTasks.filter(task => !taskPlace(task) && task.category !== 'coursework');
  const uniTasks = dayTasks.filter(task => taskPlace(task) && samePlace(taskPlace(task), uniPlace));
  const uniEvents = todayEvents.filter(event => eventPlace(event) && samePlace(eventPlace(event), uniPlace));
  const homeTasks = dayTasks.filter(task => /hammersmith|home/i.test(taskPlace(task)));
  const homeEvents = todayEvents.filter(event => /hammersmith|home/i.test(eventPlace(event)));
  const shoppingStops = useMemo(() => {
    const groups = new Map<string, { name: string; location: string; items: string[] }>();
    for (const item of shoppingItems.filter(item => !item.purchased && item.assignedShopId && item.assignedShopName)) {
      const key = item.assignedShopId!;
      const group = groups.get(key) ?? { name: item.assignedShopName!, location: item.assignedShopLocation || '', items: [] };
      group.items.push(item.name);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [shoppingItems]);
  const otherStops = [
    ...dayTasks.filter(task => taskPlace(task) && !uniTasks.includes(task) && !homeTasks.includes(task)).map(task => ({ kind: 'task' as const, task, place: taskPlace(task) })),
    ...todayEvents.filter(event => eventPlace(event) && !uniEvents.includes(event) && !homeEvents.includes(event)).map(event => ({ kind: 'event' as const, event, place: eventPlace(event) }))
  ];
  const needsUniCommute = uniTasks.length > 0 || uniEvents.length > 0;
  const mapsRoute = (origin: string, destination: string) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=transit`;
  const taskLabel = (title: string) => /student id/i.test(title) ? 'Student ID pickup' : /medicine.*hammersmith|hammersmith.*pharmacy/i.test(title) ? 'Hammersmith pharmacy' : title;

  return <div className="px-4 pb-28 max-w-3xl mx-auto space-y-4">
    <Card className="p-5 bg-white">
      <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-slate-400">Today</p><h2 className="text-2xl font-semibold text-slate-900 mt-1">{today.toLocaleDateString(undefined, { weekday: 'long' })}</h2><p className="text-sm text-slate-500">{today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div><CalendarDays className="text-indigo-500" /></div>
      <div className="mt-5 flex items-center gap-4"><span className="text-5xl" aria-label="weather">{current ? weatherIcon(current.weather_code) : '🌤️'}</span><div><p className="text-3xl font-semibold">{current ? `${Math.round(current.temperature_2m)}°` : '—'}</p><p className="text-sm text-slate-700">{current ? weatherDescription(current.weather_code) : 'Weather'}</p><p className="text-xs text-slate-500">{weatherError || (current ? `${settings.homeAddress} · ${rainWindow}` : 'Loading local forecast…')}</p></div></div>
      {current && <div className="flex gap-4 mt-4 text-xs text-slate-600"><span className="flex items-center gap-1"><Wind size={14}/> {Math.round(current.wind_speed_10m)} km/h</span><span className="flex items-center gap-1"><Droplets size={14}/> {current.relative_humidity_2m}% humidity</span></div>}
    </Card>
    {recommendation && <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Shirt size={17} className="text-indigo-600"/><h3 className="font-semibold">Today’s outfit</h3></div><div className="grid grid-cols-[1fr_0.8fr] gap-4 items-center"><div className="flex flex-col gap-2">{recommendation.garments.map(g => <div key={g.id} className="flex flex-col items-center rounded-xl bg-slate-50 p-2"><div className="h-24 w-full"><BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} fit="contain" className="h-full w-full"/></div><span className="mt-1 text-[11px] text-slate-500">{g.name}</span></div>)}</div><div className="space-y-2"><p className="text-sm font-semibold text-slate-800">{recommendation.totalScore} outfit score</p><div className="rounded-xl bg-indigo-50 p-3"><p className="text-xs text-slate-500">Colour harmony</p><p className="text-xl font-semibold text-indigo-700">{recommendation.metrics.colorHarmony}%</p></div><div className="rounded-xl bg-sky-50 p-3"><p className="text-xs text-slate-500">Warmth</p><p className="text-xl font-semibold text-sky-700">{recommendation.metrics.estimatedWarmth}/10</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-slate-500">Formality</p><p className="text-xl font-semibold text-amber-700">{recommendation.metrics.formality}/10</p></div></div></div></Card>}
    <Card className="p-4"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><MapPin size={17} className="text-indigo-600"/><h3 className="font-semibold text-slate-800">Today’s agenda</h3></div><Badge tone="indigo">{dayTasks.length + todayEvents.length} items</Badge></div><div className="space-y-3">
      {assignmentTasks.map(task => <div key={task.id} className="flex gap-3 rounded-xl bg-amber-50 p-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"/><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Assignment due today</p><p className="text-sm font-medium text-slate-800">{task.title}</p></div></div>)}
      {generalTasks.map(task => <div key={task.id} className="flex gap-3 rounded-xl bg-slate-50 p-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500"/><p className="text-sm text-slate-700">{task.title}</p></div>)}
      {needsUniCommute && <div className="rounded-xl border border-indigo-100 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Commute to uni</p><p className="text-sm text-slate-700">Home → {uniPlace}</p></div><a aria-label="Commute to university in Google Maps by public transport" href={mapsRoute(settings.homeAddress, uniPlace)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white"><Navigation size={14}/> Google Maps · Transit</a></div></div>}
      {(uniTasks.length > 0 || uniEvents.length > 0) && <div className="rounded-xl bg-indigo-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-1">{uniPlace}</p>{uniTasks.map(task => <p key={task.id} className="text-sm text-slate-700">{taskLabel(task.title)}</p>)}{uniEvents.map(event => <p key={event.id} className="text-sm text-slate-700">{event.title}</p>)}</div>}
      {shoppingStops.map((stop, index) => <div key={`${stop.name}-${index}`} className="rounded-xl bg-violet-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-1">Shopping on the way home</p><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium text-slate-800">{stop.name}</p><p className="text-xs text-slate-500">{stop.items.join(' · ')}</p></div><a href={mapsRoute(uniPlace, stop.location || stop.name)} target="_blank" rel="noreferrer" aria-label={`Directions to ${stop.name}`} className="rounded-lg bg-violet-600 p-2 text-white"><Navigation size={15}/></a></div></div>)}
      {needsUniCommute && <div className="rounded-xl border border-indigo-100 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Commute from uni to home</p><p className="text-sm text-slate-700">{uniPlace} → Home{shoppingStops.length ? ' · via shopping stops above' : ''}</p></div><a aria-label="Commute home in Google Maps by public transport" href={mapsRoute(shoppingStops.length ? shoppingStops[shoppingStops.length - 1].location || uniPlace : uniPlace, settings.homeAddress)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white"><Navigation size={14}/> Google Maps · Transit</a></div></div>}
      {(homeTasks.length > 0 || homeEvents.length > 0) && <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-1">Near home</p>{homeTasks.map(task => <a key={task.id} href={mapsRoute(settings.homeAddress, taskPlace(task))} target="_blank" rel="noreferrer" className="flex items-center justify-between py-1 text-sm text-slate-700"><span>{taskLabel(task.title)}</span><MapPin size={14} className="text-emerald-700"/></a>)}{homeEvents.map(event => <p key={event.id} className="text-sm text-slate-700">{event.title}</p>)}</div>}
      {otherStops.map((stop, index) => <div key={`${stop.place}-${index}`} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{stop.place}</p><p className="text-sm text-slate-700">{stop.kind === 'task' ? taskLabel(stop.task.title) : stop.event.title}</p><a href={mapsRoute(settings.homeAddress, stop.place)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600"><Navigation size={12}/> Google Maps</a></div>)}
      {!dayTasks.length && !todayEvents.length && <p className="text-sm text-slate-400">Nothing scheduled today.</p>}
    </div><Button variant="outline" className="mt-4 w-full" onClick={openPlanner}>Plan a shopping stop</Button></Card>
  </div>;
}
