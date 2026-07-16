import { useCallback, useEffect, useRef, useState } from 'react';
import { uuid, timeEntries } from './db';
import type { EntityType } from '../types';

// A live timer that ticks in the renderer and, on stop, writes a time_entries row.
// State is kept in a ref so multiple components can share the same running timer
// via the singleton below.

export interface RunningTimer {
  entityType: EntityType;
  entityId: string | null;
  note: string;
  startedAt: number; // epoch ms
}

let running: RunningTimer | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }

export function startTimer(entityType: EntityType, entityId: string | null, note = '') {
  running = { entityType, entityId, note, startedAt: Date.now() };
  emit();
}

export function clearTimer() {
  running = null;
  emit();
}

export function getRunning() { return running; }

// Hook: subscribe to the running timer + tick every second while running.
export function useRunningTimer() {
  const [, setTick] = useState(0);
  const force = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, [force]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [!!running]);

  return running;
}

// Stop the timer and persist a time_entries row. Returns minutes elapsed (0 if nothing running).
export async function stopAndSave(): Promise<number> {
  if (!running) return 0;
  const minutes = Math.max(1, Math.round((Date.now() - running.startedAt) / 60000));
  const id = await uuid();
  await timeEntries.insert({
    id,
    entity_type: running.entityType,
    entity_id: running.entityId,
    minutes,
    entry_date: new Date().toISOString().slice(0, 10),
    note: running.note || null,
    created_at: new Date().toISOString(),
  });
  clearTimer();
  return minutes;
}

// Format the elapsed time of the running timer as HH:MM:SS.
export function formatElapsed(): string {
  if (!running) return '00:00:00';
  const secs = Math.floor((Date.now() - running.startedAt) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// Keep a ref to avoid stale closures in interval callbacks.
export function useTimerRef() {
  const ref = useRef(running);
  ref.current = running;
  return ref;
}
