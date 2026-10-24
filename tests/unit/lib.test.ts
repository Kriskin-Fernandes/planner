import { describe, it, expect } from 'vitest';
import {
  clamp,
  round1,
  daysUntil,
  hexToRgb,
  rgbToHex,
  deltaE,
  colorHarmonyScore,
  parseLocalDatePhrase,
  parseLocalRecurrencePhrase,
  parseTaskText,
  haversineMeters,
  distancePointToPolylineMeters,
  formatRelativeDays
} from '../../src/lib';

describe('clamp / round1', () => {
  it('clamps values within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('rounds to one decimal place', () => {
    expect(round1(1.2345)).toBe(1.2);
    expect(round1(1.25)).toBe(1.3);
  });
});

describe('daysUntil', () => {
  it('returns null for missing dates', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it('returns 0 for today', () => {
    expect(daysUntil(new Date().toISOString())).toBe(0);
  });

  it('returns a negative number for a past date', () => {
    const past = new Date(Date.now() - 86400000 * 3).toISOString();
    expect(daysUntil(past)).toBe(-3);
  });
});

describe('colour science (CIELAB)', () => {
  it('round-trips hex -> rgb -> hex', () => {
    expect(rgbToHex(...Object.values(hexToRgb('#336699')) as [number, number, number])).toBe('#336699');
  });

  it('gives zero perceptual distance between identical colours', () => {
    expect(deltaE('#ff0000', '#ff0000')).toBeCloseTo(0, 5);
  });

  it('gives a large perceptual distance between black and white', () => {
    expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(90);
  });

  it('scores a single colour as neutral/high harmony', () => {
    expect(colorHarmonyScore(['#2255aa'])).toBeGreaterThanOrEqual(80);
  });

  it('keeps colour harmony score within 0-100', () => {
    const score = colorHarmonyScore(['#ff0000', '#00ff00', '#0000ff', '#ffff00']);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('local date phrase parsing', () => {
  const fixedNow = new Date('2026-10-24T08:00:00.000Z'); // a Saturday

  it('parses "tomorrow"', () => {
    const result = parseLocalDatePhrase('tomorrow', fixedNow);
    expect(result?.getDate()).toBe(25);
  });

  it('parses "in 3 days"', () => {
    const result = parseLocalDatePhrase('in 3 days', fixedNow);
    expect(result?.getDate()).toBe(27);
  });

  it('returns null when no recognisable phrase is present', () => {
    expect(parseLocalDatePhrase('buy milk', fixedNow)).toBeNull();
  });

  it('parses a time of day when present', () => {
    const result = parseLocalDatePhrase('tomorrow at 5pm', fixedNow);
    expect(result?.getHours()).toBe(17);
  });
});

describe('local recurrence phrase parsing', () => {
  it('parses "every 2 weeks"', () => {
    expect(parseLocalRecurrencePhrase('every 2 weeks')).toEqual({ freq: 'weekly', interval: 2 });
  });

  it('parses "daily"', () => {
    expect(parseLocalRecurrencePhrase('remind me daily')).toEqual({ freq: 'daily', interval: 1 });
  });

  it('defaults to no recurrence', () => {
    expect(parseLocalRecurrencePhrase('buy milk')).toEqual({ freq: 'none', interval: 1 });
  });
});

describe('parseTaskText', () => {
  it('extracts a due date and leaves a clean title', () => {
    const result = parseTaskText('Submit assignment tomorrow');
    expect(result.dueAt).not.toBeNull();
    expect(result.title.toLowerCase()).toContain('submit assignment');
  });

  it('detects urgent priority keywords', () => {
    const result = parseTaskText('Call landlord urgent');
    expect(result.priority).toBe('urgent');
  });
});

describe('geo distance helpers', () => {
  it('computes ~0 distance for identical points', () => {
    const p = { lat: 51.5, lon: -0.1 };
    expect(haversineMeters(p, p)).toBeCloseTo(0, 5);
  });

  it('computes a plausible distance between London and Paris', () => {
    const london = { lat: 51.5074, lon: -0.1278 };
    const paris = { lat: 48.8566, lon: 2.3522 };
    const d = haversineMeters(london, paris);
    expect(d).toBeGreaterThan(300000);
    expect(d).toBeLessThan(400000);
  });

  it('finds zero distance for a point on the polyline', () => {
    const line = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }];
    expect(distancePointToPolylineMeters({ lat: 0, lon: 0.5 }, line)).toBeCloseTo(0, 0);
  });
});

describe('formatRelativeDays', () => {
  it('labels today, tomorrow, and overdue correctly', () => {
    expect(formatRelativeDays(0)).toBe('Today');
    expect(formatRelativeDays(1)).toBe('Tomorrow');
    expect(formatRelativeDays(-2)).toBe('2d overdue');
    expect(formatRelativeDays(null)).toBe('No date');
  });
});
