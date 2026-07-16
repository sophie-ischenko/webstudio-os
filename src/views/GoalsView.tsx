import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Target, CheckCircle2, Pencil } from 'lucide-react';
import { goals2, uuid } from '../lib/db';
import type { Goal, GoalPeriodType, GoalCategory } from '../types';
import { isoWeek, startOfWeek } from '../lib/format';
import { Badge, EmptyState, Field, Modal } from '../components/ui';


const PERIOD_LABELS: Record<GoalPeriodType, string> = {
  week: 'Woche', month: 'Monat', quarter: 'Quartal', year: 'Jahr',
};
const CATEGORY_LABELS: Record<GoalCategory, string> = {
  revenue: 'Umsatz', time: 'Zeit', projects: 'Projekte', social: 'Social', personal: 'Persönlich',
};
const CATEGORY_TONE: Record<GoalCategory, 'accent' | 'info' | 'success' | 'warning' | 'neutral'> = {
  revenue: 'success', time: 'info', projects: 'accent', social: 'warning', personal: 'neutral',
};

function periodKey(type: GoalPeriodType, offset: number): string {
  const d = new Date();
  if (type === 'week') {
    d.setDate(d.getDate() + offset * 7);
    const ws = startOfWeek(d);
    return `${ws.getFullYear()}-W${String(isoWeek(ws)).padStart(2, '0')}`;
  }
  if (type === 'month') {
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  if (type === 'quarter') {
    d.setMonth(d.getMonth() + offset * 3);
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  // year
  return String(d.getFullYear() + offset);
}

function periodLabel(type: GoalPeriodType, key: string): string {
  if (type === 'week') {
    const [y, w] = key.split('-W');
    return `KW ${w} ${y}`;
  }
  if (type === 'month') {
    const [y, m] = key.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }
  if (type === 'quarter') {
    return key.replace('-', ' ');
  }
  return key;
}

export function GoalsView() {
  const [periodType, setPeriodType] = useState<GoalPeriodType>('week');
  const [offset, setOffset] = useState(0);
  const [goalList, setGoalList] = useState<Goal[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const currentKey = periodKey(periodType, offset);

  const load = useCallback(async () => {
    setGoalList(await goals2.byPeriod(periodType, currentKey));
  }, [periodType, currentKey]);

  useEffect(() => { load(); }, [load]);

  async function updateProgress(id: string, currentValue: number) {
    const g = goalList.find(x => x.id === id);
    if (!g) return;
    const isCompleted = g.target_value != null && currentValue >= g.target_value ? 1 : 0;
    await goals2.update(id, {
      current_value: currentValue,
      is_completed: isCompleted,
      completed_at: isCompleted && !g.is_completed ? new Date().toISOString() : null,
    });
    load();
  }

  async function toggleComplete(id: string) {
    const g = goalList.find(x => x.id === id);
    if (!g) return;
    const next = g.is_completed ? 0 : 1;
    await goals2.update(id, {
      is_completed: next,
      completed_at: next ? new Date().toISOString() : null,
    });
    load();
  }

  async function remove(id: string) {
    await goals2.remove(id);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Zielplaner</h1>
          <p className="text-sm text-ink-500 mt-0.5">Verfolge Wochen-, Monats-, Quartals- und Jahresziele</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Neues Ziel
        </button>
      </div>

      {/* Period selector */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex bg-surfaceMuted rounded-lg p-0.5">
            {(['week', 'month', 'quarter', 'year'] as GoalPeriodType[]).map(t => (
              <button
                key={t}
                onClick={() => { setPeriodType(t); setOffset(0); }}
                className={`px-3 py-1.5 rounded-md text-sm ${periodType === t ? 'bg-surface shadow-soft text-ink-900' : 'text-ink-500'}`}
              >
                {PERIOD_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(o => o - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt text-ink-500">‹</button>
            <button onClick={() => setOffset(0)} className="btn-ghost text-sm">Aktuell</button>
            <button onClick={() => setOffset(o => o + 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt text-ink-500">›</button>
          </div>
          <p className="text-sm font-medium text-ink-900 min-w-[120px] text-right">{periodLabel(periodType, currentKey)}</p>
        </div>

        {goalList.length === 0 ? (
          <EmptyState
            icon={<Target size={28} />}
            title={`Keine Ziele für ${periodLabel(periodType, currentKey)}`}
            hint="Lege Ziele für diese Periode an — z.B. Umsatz, Stunden, Projektanzahl."
            action={<button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={16} /> Neues Ziel</button>}
          />
        ) : (
          <div className="space-y-3">
            {goalList.map(g => (
              <GoalRow
                key={g.id}
                goal={g}
                onProgress={(v) => updateProgress(g.id, v)}
                onToggle={() => toggleComplete(g.id)}
                onEdit={() => setEditing(g)}
                onRemove={() => remove(g.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AddGoalModal
        open={showAdd || editing !== null}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        onSaved={load}
        periodType={periodType}
        periodKey={currentKey}
        existing={editing}
      />
    </div>
  );
}

function GoalRow({ goal, onProgress, onToggle, onEdit, onRemove }: {
  goal: Goal;
  onProgress: (v: number) => void;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const hasTarget = goal.target_value != null && goal.target_value > 0;
  const pct = hasTarget ? Math.min(100, Math.round((goal.current_value / (goal.target_value as number)) * 100)) : 0;
  const isDone = goal.is_completed === 1;

  return (
    <div className={`p-4 rounded-lg border ${isDone ? 'border-success-200 bg-success-50/30' : 'border-line bg-surfaceAlt/30'}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
            ${isDone ? 'bg-success-500 border-success-500 text-white' : 'border-line hover:border-accent-300'}`}
        >
          {isDone && <CheckCircle2 size={12} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className={`text-sm font-medium ${isDone ? 'text-ink-500 line-through' : 'text-ink-900'}`}>{goal.title}</p>
            {goal.category && <Badge tone={CATEGORY_TONE[goal.category]}>{CATEGORY_LABELS[goal.category]}</Badge>}
          </div>
          {goal.notes && <p className="text-2xs text-ink-500 mb-2">{goal.notes}</p>}
          {hasTarget ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-ink-500 tabular-nums">
                  {goal.current_value} / {goal.target_value} {goal.unit || ''}
                </span>
                <span className="text-2xs font-semibold text-ink-700 tabular-nums">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-surfaceMuted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-success-500' : 'bg-accent-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  step="0.5"
                  className="input w-28 text-sm"
                  value={goal.current_value}
                  onChange={(e) => onProgress(parseFloat(e.target.value) || 0)}
                />
                <span className="text-2xs text-ink-400">{goal.unit || 'Fortschritt aktualisieren'}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                step="0.5"
                className="input w-28 text-sm"
                value={goal.current_value}
                onChange={(e) => onProgress(parseFloat(e.target.value) || 0)}
                placeholder="Fortschritt"
              />
              <span className="text-2xs text-ink-400">{goal.unit || 'Aktueller Wert'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-accent-600"><Pencil size={14} /></button>
          <button onClick={onRemove} className="p-1.5 text-ink-400 hover:text-danger-600"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function AddGoalModal({ open, onClose, onSaved, periodType, periodKey, existing }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  periodType: GoalPeriodType;
  periodKey: string;
  existing: Goal | null;
}) {
  const [title, setTitle] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState<GoalCategory | ''>('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setTargetValue(existing.target_value != null ? String(existing.target_value) : '');
      setUnit(existing.unit || '');
      setCategory(existing.category || '');
      setNotes(existing.notes || '');
    } else {
      setTitle(''); setTargetValue(''); setUnit(''); setCategory(''); setNotes('');
    }
  }, [existing, open]);

  async function save() {
    if (!title.trim()) return;
    const id = existing?.id || await uuid();
    const data = {
      id,
      title: title.trim(),
      period_type: periodType,
      period_key: periodKey,
      target_value: targetValue ? parseFloat(targetValue) : null,
      current_value: existing?.current_value || 0,
      unit: unit || null,
      category: (category || null) as GoalCategory | null,
      notes: notes || null,
      is_completed: 0,
      completed_at: null,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      await goals2.update(existing.id, {
        title: data.title, target_value: data.target_value, unit: data.unit,
        category: data.category, notes: data.notes,
      });
    } else {
      await goals2.insert(data);
    }
    onSaved();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Ziel bearbeiten' : 'Neues Ziel'} size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={save} className="btn-primary" disabled={!title.trim()}>{existing ? 'Speichern' : 'Erstellen'}</button></>}
    >
      <div className="space-y-4">
        <Field label="Ziel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. 3 Projekte abschließen" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zielwert (optional)"><input type="number" step="0.5" className="input" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="z.B. 5000" /></Field>
          <Field label="Einheit"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="z.B. €, Stunden, Projekte" /></Field>
        </div>
        <Field label="Kategorie">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as GoalCategory | '')}>
            <option value="">— Keine —</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Notizen"><textarea className="input min-h-[60px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-2xs text-ink-400">
          Periode: {PERIOD_LABELS[periodType]} · {periodLabel(periodType, periodKey)}
        </p>
      </div>
    </Modal>
  );
}
