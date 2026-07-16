// Formatting helpers — money (cents), dates, durations.

export function formatMoney(cents: number, currency = 'EUR'): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export function formatMoneyShort(cents: number): string {
  if (Math.abs(cents) >= 100000) {
    return `${(cents / 100 / 1000).toFixed(1)}k €`;
  }
  return formatMoney(cents);
}

export function parseMoneyToCents(input: string): number {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

export function formatDuration(minutes: number): string {
  if (!minutes) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace('.', ',') + ' h';
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function relativeDeadline(iso: string | null | undefined): { label: string; tone: 'overdue' | 'soon' | 'normal' } {
  const days = daysUntil(iso);
  if (days === null) return { label: '—', tone: 'normal' };
  if (days < 0) return { label: `${Math.abs(days)} T überfällig`, tone: 'overdue' };
  if (days === 0) return { label: 'heute', tone: 'soon' };
  if (days <= 3) return { label: `in ${days} T`, tone: 'soon' };
  return { label: `in ${days} T`, tone: 'normal' };
}

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = d.valueOf();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - d.valueOf()) / (7 * 24 * 3600 * 1000));
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
