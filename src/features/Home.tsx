import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Navigation, Shirt, Wind, Droplets } from 'lucide-react';
import { useApp } from '../context';
import { Button, Card, Badge, BlobImage } from '../components';
import { recommendOutfits } from '../services';
import { geocode } from '../geo';
import type { GeoPoint } from '../types';

export default function Home({ openPlanner }: { openPlanner: () => void }) {
  const { tasks, calendarEvents, garments, settings, preferences } = useApp();
  const [weather, setWeather] = useState<any>(null);
  const [weatherError, setWeatherError] = useState('');
  const today = new Date();
  const dayTasks = useMemo(() => tasks.filter(t => !t.completed && (t.recurrence.freq === 'daily' || (t.dueAt && new Date(t.dueAt).toDateString() === today.toDateString()))), [tasks]);
  const todayEvents = useMemo(() => calendarEvents.filter(e => new Date(e.start).toDateString() === today.toDateString()), [calendarEvents]);
  const recommendation = useMemo(() => recommendOutfits(garments, { maxResults: 1 })[0], [garments]);

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

  const routeStops = useMemo(() => {
    const dayTaskStops = dayTasks.map(t => ({ label: t.title, place: t.location || (t.locationTag ? preferences.locationTags[t.locationTag] : '') })).filter(s => s.place);
    const eventStops = todayEvents.map(e => ({ label: e.title, place: e.location || (e.locationTag ? preferences.locationTags[e.locationTag] : '') })).filter(s => s.place);
    const seen = new Set<string>();
    return [...dayTaskStops, ...eventStops].filter(s => { const key = s.place.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  }, [dayTasks, todayEvents, preferences.locationTags]);
  const destinationPlaces = routeStops.length ? routeStops.map(s => s.place) : [preferences.locationTags.Uni || 'Imperial College London'];
  const destination = destinationPlaces[destinationPlaces.length - 1];
  const waypoints = destinationPlaces.slice(0, -1);
  const routeUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(settings.homeAddress)}&destination=${encodeURIComponent(destination)}${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}` : ''}&travelmode=transit`;
  const todoTitles = [...dayTasks.map(t => t.title), ...todayEvents.map(e => e.title)];

  return <div className="px-4 pb-28 max-w-3xl mx-auto space-y-4">
    <Card className="p-5 bg-white">
      <div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-slate-400">Today</p><h2 className="text-2xl font-semibold text-slate-900 mt-1">{today.toLocaleDateString(undefined, { weekday: 'long' })}</h2><p className="text-sm text-slate-500">{today.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p></div><CalendarDays className="text-indigo-500" /></div>
      <div className="mt-5 flex items-center gap-4"><span className="text-5xl" aria-label="weather">{current ? weatherIcon(current.weather_code) : '🌤️'}</span><div><p className="text-3xl font-semibold">{current ? `${Math.round(current.temperature_2m)}°` : '—'}</p><p className="text-sm text-slate-700">{current ? weatherDescription(current.weather_code) : 'Weather'}</p><p className="text-xs text-slate-500">{weatherError || (current ? `${settings.homeAddress} · ${rainWindow}` : 'Loading local forecast…')}</p></div></div>
      {current && <div className="flex gap-4 mt-4 text-xs text-slate-600"><span className="flex items-center gap-1"><Wind size={14}/> {Math.round(current.wind_speed_10m)} km/h</span><span className="flex items-center gap-1"><Droplets size={14}/> {current.relative_humidity_2m}% humidity</span></div>}
    </Card>
    <Card className="p-4"><h3 className="font-semibold text-slate-800 mb-3">Today’s to-dos</h3>{todoTitles.length ? <ul className="space-y-2">{todoTitles.map((title, i) => <li key={`${title}-${i}`} className="text-sm flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-indigo-500"/>{title}</li>)}</ul> : <p className="text-sm text-slate-400">Nothing due today. Enjoy the breathing room.</p>}</Card>
    {recommendation && <Card className="p-4"><div className="flex items-center gap-2 mb-3"><Shirt size={17} className="text-indigo-600"/><h3 className="font-semibold">Recommended outfit</h3></div><div className="flex flex-col items-center gap-1 bg-slate-50 rounded-xl py-4">{recommendation.garments.map(g => <div key={g.id} className="h-12 w-28 rounded-lg overflow-hidden border border-white shadow-sm"><BlobImage blobKey={g.images[0]?.blobKey} url={g.images[0]?.url} alt={g.name} className="w-full h-full"/></div>)}</div><p className="text-xs text-slate-500 mt-2 text-center">{recommendation.garments.map(g => g.name).join(' · ')}</p></Card>}
    <Card className="p-4 bg-indigo-600 text-white border-0"><div className="flex items-center gap-2"><MapPin size={17}/><h3 className="font-semibold">Today’s route</h3><Badge tone="slate">{routeStops.length} stops</Badge></div><p className="text-sm text-indigo-100 mt-2 mb-3">{routeStops.length ? routeStops.map(t => t.place).join(' · ') : `Home → ${destination}`}</p><a href={routeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-indigo-700"><Navigation size={15}/> View daily route in Google Maps</a><div className="mt-3"><Button variant="ghost" className="!text-white" onClick={openPlanner}>Plan a shopping stop</Button></div></Card>
  </div>;
}
