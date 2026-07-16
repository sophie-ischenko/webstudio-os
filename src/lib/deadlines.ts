import type { Project, Todo, Invoice } from '../types';
import { relativeDeadline } from './format';

export type DeadlineItem = {
  id: string;
  type: 'project' | 'todo' | 'invoice';
  label: string;
  date: string | null;
  tone: 'overdue' | 'soon' | 'neutral';
};

function normalize(date?: string | null): string | null {
  return date ? new Date(date).toISOString() : null;
}

// lib/deadlines.ts

export function collectDeadlines({
  projects = [],
  todos = [],
  invoices = [],
}: {
  projects: any[];
  todos: any[];
  invoices: any[];
}) {
  const out: {
    id: string;
    type: 'project' | 'todo' | 'invoice';
    label: string;
    date: string;
  }[] = [];

  // PROJECTS
  for (const p of projects) {
    const date = p.target_end_date;
    if (!date) continue;

    out.push({
      id: p.id,
      type: 'project',
      label: `Projekt: ${p.name}`,
      date,
    });
  }

  // TODOS
  for (const t of todos) {
    const date = t.due_date;
    if (!date) continue;

    out.push({
      id: t.id,
      type: 'todo',
      label: `To-do: ${t.title}`,
      date,
    });
  }

  // INVOICES
  for (const i of invoices) {
    const date = i.due_date;
    if (!date) continue;

    out.push({
      id: i.id,
      type: 'invoice',
      label: `Rechnung ${i.number ?? i.id}`,
      date,
    });
  }
  console.log("deadlines", out.map(d => ({ ...d, relative: relativeDeadline(d.date) })));
  return out;
}