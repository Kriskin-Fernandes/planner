import React, { useMemo } from 'react';
import { CalendarDays, CloudSun, MapPin, Navigation, Shirt, Wind, Droplets } from 'lucide-react';
import { useApp } from '../context';
import { Button, Card, Badge, BlobImage } from '../components';
import { recommendOutfits } from '../services';

export default function Home({ openPlanner }: { openPlanner: () => void }) {
  const { tasks, calendarEvents, garments, settings } = useApp();
  const weather: any = null;
  const weatherError = settings.homeAddress ? 'Weather connection needs your approval to use the saved location.' : 'Add your home address in Settings for local weather.';
  const today = new Date();
  const dayTasks = useMemo(() => tasks.filter(t => !t.completed && t.dueAt && new Date(t.dueAt).toDateString() === today.toDateString()), [tasks]);
  const todayEvents = useMemo(() => calendarEvents.filter(e => new Date(e.start).toDateString() === today.toDateString()), [calendarEvents]);
  const recommendation = useMemo(() => recommendOutfits(garments, { maxResults: 1 })[0], [garments]);

  const current = weather?.current;
  const rainHours: string[] = weather?.hourly?.time?.filter((_: string, i: number) => (weather.hourly.precipitation_probability[i] ?? 0) >= 35).map((v: string) => new Date(v).toLocaleTimeString([], { hour: 'numeric' })) ?? [];
  const rainWindow = rainHours.length ? `Rain possible ${rainHours[0]}–${rainHours[rainHours.length - 1]}` : 'No significant rain expected';
  const icon = (code: number) => code === 0 ? '☀️' : code < 3 ? '🌤️' : code < 50 ? '☁️' : '🌧️';
  const groupedTasks = [...tasks.filter(t => !t.completed && t.location), ...calendarEvents.filter(e => new Date(e.start).toDateString() === today.toDateString()).map(e => ({ title: e.title, location: e.location }))];

  return <div className="px-4 pb-28 max-w-3xl mx-auto space-y-4">
    <Card className="p-5 bg-white">
      <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-slate-400">Today</p><h2 className="text-2xl font-semibold text-slate-900 mt-1">{today.toLocaleDateString(undefined, { weekday: 'long' })}</h2><p className="text-sm text-slate-500">{today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div><CalendarDays className="text-indigo-500" /></div>
      <div className="mt-5 flex items-center gap-4"><span className="text-5xl" aria-label="weather">{current ? icon(current.weather_code) : '🌤️'}</span><div><p className="text-3xl font-semibold">{current ? `${Math.round(current.temperature_2m)}°` : '—'}</p><p className="text-xs text-slate-500">{weatherError || (settings.homeAddress ? `${settings.homeAddress} · ${rainWindow}` : 'Set a home location in Settings')}</p></div></div>
      {current && <div className="flex gap-4 mt-4 text-xs text-slate-600"><span className="flex items-center gap-1"><Wind size={14}/> {Math.round(current.wind_speed_10m)} km/h</span><span className="flex items-center gap-1"><Droplets size={14}/> {current.relative_humidity_2m}% humidity</span></div>}
    </Card>
    <Card className="p-4"><h3 className="font-semibold text-slate-800 mb-3">Today’s to-dos</h3>{[...dayTasks.map(t => t.title), ...todayEvents.map(e => e.title)].length ? <ul className="space-y-2">{[...dayTasks.map(t => t.title), ...todayEvents.map(e => e.title)].map((title, i) => <li key={`${title}-${i}`} className="text-sm flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-500"/>{title}</li>)}</ul> : <p className="text-sm text-slate-400">Nothing due today. Enjoy the breathing room.</p>}</Card>
    {recommendation && <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Shirt size={17} className="text-indigo-600"/><h3 className="font-semibold">Recommended outfit</h3></div><div className="flex flex-col items-center gap-1 bg-slate-50 rounded-xl py-4">{recommendation.garments.map(g => <div key={g.id} className="h-12 w-28 rounded-lg overflow-hidden border border-white shadow-sm"><BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full"/></div>)}</div><p className="text-xs text-slate-500 mt-2 text-center">{recommendation.garments.map(g => g.name).join(' · ')}</p></Card>}
    <Card className="p-4 bg-indigo-600 text-white border-0"><div className="flex items-center gap-2"><MapPin size={17}/><h3 className="font-semibold">Today’s route</h3><Badge tone="slate">{groupedTasks.length} stops</Badge></div><p className="text-sm text-indigo-100 mt-2 mb-3">{groupedTasks.length ? groupedTasks.map(t => t.location || t.title).join(' · ') : 'Group errands, assignments, and shopping by location.'}</p><Button variant="outline" className="!bg-white !text-indigo-700" onClick={openPlanner}><Navigation size={15}/> View daily route</Button></Card>
  </div>;
}
