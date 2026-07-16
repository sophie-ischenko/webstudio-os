import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, Save, FileText, GripVertical, Euro, Clock,
} from 'lucide-react';
import { priceCalcs, uuid } from '../lib/db';
import type { ProjectPriceCalc, PricePosition, ExtraCost } from '../types';
import { formatMoney, formatDate, parseMoneyToCents } from '../lib/format';
import { EmptyState, Field, Modal, SectionHeader } from '../components/ui';

export function ProjectCalculatorView() {
  const [list, setList] = useState<ProjectPriceCalc[]>([]);
  const [editing, setEditing] = useState<ProjectPriceCalc | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setList(await priceCalcs.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  if (editing) {
    return <CalcEditor calc={editing} onBack={() => { setEditing(null); load(); }} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Projektpreis-Kalkulator</h1>
          <p className="text-sm text-ink-500 mt-0.5">Berechne Projektpreise aus Positionen, Stunden und Sätzen</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={16} /> Neue Kalkulation
        </button>
      </div>

      <div className="card p-5">
        <SectionHeader title="Gespeicherte Kalkulationen" />
        {list.length === 0 ? (
          <EmptyState
            icon={<FileText size={28} />}
            title="Noch keine Kalkulationen"
            hint="Lege eine neue Kalkulation an, um Projektpreise zu berechnen."
            action={<button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} /> Neue Kalkulation</button>}
          />
        ) : (
          <div className="space-y-2">
            {list.map(c => (
              <button
                key={c.id}
                onClick={() => setEditing(c)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-surfaceAlt transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center">
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">{c.label || 'Unbenannte Kalkulation'}</p>
                  <p className="text-2xs text-ink-500">
                    {c.client_name || 'Keine Kundin'} · {formatDate(c.created_at)} · {c.total_hours.toFixed(1)} h
                  </p>
                </div>
                <span className="text-sm font-semibold text-ink-900 tabular-nums">{formatMoney(c.total_cents)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <NewCalcModal open={showNew} onClose={() => setShowNew(false)} onCreated={(c) => setEditing(c)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function CalcEditor({ calc, onBack }: { calc: ProjectPriceCalc; onBack: () => void }) {
  const [label, setLabel] = useState(calc.label || '');
  const [clientName, setClientName] = useState(calc.client_name || '');
  const [positions, setPositions] = useState<PricePosition[]>(JSON.parse(calc.positions_json || '[]'));
  const [extraCosts, setExtraCosts] = useState<ExtraCost[]>(JSON.parse(calc.extra_costs_json || '[]'));
  const [discountCents, setDiscountCents] = useState(calc.discount_cents);
  const [bufferPct, setBufferPct] = useState(calc.buffer_pct);
  const [notes, setNotes] = useState(calc.notes || '');

  // Live calculation
  const result = useMemo(() => {
    const positionsTotal = positions.reduce((s, p) => {
      if (p.type === 'flat') return s + p.hourly_rate_cents;
      return s + Math.round(p.hours * p.hourly_rate_cents);
    }, 0);
    const extraTotal = extraCosts.reduce((s, e) => s + e.amount_cents, 0);
    const subtotal = positionsTotal + extraTotal;
    const afterDiscount = Math.max(0, subtotal - discountCents);
    const withBuffer = Math.round(afterDiscount * (1 + bufferPct / 100));
    const totalHours = positions.reduce((s, p) => s + (p.type === 'flat' ? 0 : p.hours), 0);
    return { positionsTotal, extraTotal, subtotal, afterDiscount, withBuffer, totalHours };
  }, [positions, extraCosts, discountCents, bufferPct]);

  function addPosition() {
    setPositions([...positions, { name: '', hours: 0, hourly_rate_cents: 5000, type: 'service' }]);
  }

  function updatePosition(i: number, field: keyof PricePosition, value: string | number) {
    const next = [...positions];
    (next[i] as unknown as Record<string, unknown>)[field] = value;
    setPositions(next);
  }

  function removePosition(i: number) {
    setPositions(positions.filter((_, idx) => idx !== i));
  }

  function addExtra() {
    setExtraCosts([...extraCosts, { label: '', amount_cents: 0 }]);
  }

  function updateExtra(i: number, field: keyof ExtraCost, value: string | number) {
    const next = [...extraCosts];
    (next[i] as unknown as Record<string, unknown>)[field] = value;
    setExtraCosts(next);
  }

  function removeExtra(i: number) {
    setExtraCosts(extraCosts.filter((_, idx) => idx !== i));
  }

  async function save() {
    await priceCalcs.update(calc.id, {
      label: label || null,
      client_name: clientName || null,
      positions_json: JSON.stringify(positions),
      extra_costs_json: JSON.stringify(extraCosts),
      discount_cents: discountCents,
      buffer_pct: bufferPct,
      subtotal_cents: result.subtotal,
      total_cents: result.withBuffer,
      total_hours: result.totalHours,
      notes: notes || null,
    });
    onBack();
  }

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="btn-ghost -ml-2 mb-2 text-sm">
          <Plus size={16} className="rotate-45" /> Zurück zur Liste
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <input
              className="input text-lg font-medium !border-transparent !bg-transparent !px-0 !text-2xl"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Kalkulation-Name"
            />
            <input
              className="input !border-transparent !bg-transparent !px-0 text-sm text-ink-500"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Kundin (optional)"
            />
          </div>
          <button onClick={save} className="btn-primary"><Save size={15} /> Speichern</button>
        </div>
      </div>

      {/* Positions */}
      <div className="card p-5">
        <SectionHeader title="Positionen" action={<button onClick={addPosition} className="btn-ghost text-sm"><Plus size={14} /> Position</button>} />
        {positions.length === 0 ? (
          <EmptyState title="Keine Positionen" hint="Füge Positionen hinzu — pro Zeile Stunden × Stundensatz oder Pauschale." />
        ) : (
          <div className="space-y-2">
            {positions.map((p, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-surfaceAlt/40">
                <GripVertical size={14} className="text-ink-300 shrink-0" />
                <input
                  className="input flex-1 text-sm"
                  placeholder="Positionsname (z.B. 'Startseite Design')"
                  value={p.name}
                  onChange={(e) => updatePosition(i, 'name', e.target.value)}
                />
                <select
                  className="input w-28 text-sm"
                  value={p.type}
                  onChange={(e) => updatePosition(i, 'type', e.target.value)}
                >
                  <option value="service">Stunden</option>
                  <option value="flat">Pauschale</option>
                </select>
                {p.type === 'service' ? (
                  <>
                    <input
                      type="number"
                      step="0.25"
                      className="input w-20 text-sm tabular-nums"
                      placeholder="Std"
                      value={p.hours}
                      onChange={(e) => updatePosition(i, 'hours', parseFloat(e.target.value) || 0)}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input w-24 text-sm tabular-nums"
                      placeholder="Satz €"
                      value={p.hourly_rate_cents / 100}
                      onChange={(e) => updatePosition(i, 'hourly_rate_cents', parseMoneyToCents(e.target.value))}
                    />
                    <span className="text-sm font-medium text-ink-900 tabular-nums w-24 text-right">
                      {formatMoney(Math.round(p.hours * p.hourly_rate_cents))}
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input w-24 text-sm tabular-nums"
                      placeholder="Betrag €"
                      value={p.hourly_rate_cents / 100}
                      onChange={(e) => updatePosition(i, 'hourly_rate_cents', parseMoneyToCents(e.target.value))}
                    />
                    <span className="text-sm font-medium text-ink-900 tabular-nums w-24 text-right">
                      {formatMoney(p.hourly_rate_cents)}
                    </span>
                  </>
                )}
                <button onClick={() => removePosition(i)} className="p-1 text-ink-400 hover:text-danger-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Extra costs */}
      <div className="card p-5">
        <SectionHeader title="Zusätzliche Kosten" action={<button onClick={addExtra} className="btn-ghost text-sm"><Plus size={14} /> Kosten</button>} />
        {extraCosts.length === 0 ? (
          <p className="text-sm text-ink-400 py-2">Keine zusätzlichen Kosten (z.B. Hosting, Lizenzen, Stockfotos)</p>
        ) : (
          <div className="space-y-2">
            {extraCosts.map((e, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-surfaceAlt/40">
                <input
                  className="input flex-1 text-sm"
                  placeholder="Bezeichnung (z.B. 'Hosting 1 Jahr')"
                  value={e.label}
                  onChange={(ev) => updateExtra(i, 'label', ev.target.value)}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="input w-28 text-sm tabular-nums"
                  placeholder="Betrag €"
                  value={e.amount_cents / 100}
                  onChange={(ev) => updateExtra(i, 'amount_cents', parseMoneyToCents(ev.target.value))}
                />
                <button onClick={() => removeExtra(i)} className="p-1 text-ink-400 hover:text-danger-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary + adjustments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5 space-y-3">
          <SectionHeader title="Anpassungen" />
          <Field label="Rabatt (€)">
            <input
              type="text"
              inputMode="decimal"
              className="input"
              value={discountCents / 100}
              onChange={(e) => setDiscountCents(parseMoneyToCents(e.target.value))}
            />
          </Field>
          <Field label="Puffer / Aufschlag (%)" hint="Sicherheitspuffer für unvorhergesehene Aufwände">
            <input
              type="number"
              className="input"
              value={bufferPct}
              onChange={(e) => setBufferPct(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <Field label="Notizen">
            <textarea className="input min-h-[80px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="card p-5 flex flex-col">
          <SectionHeader title="Zusammenfassung" />
          <div className="space-y-2.5 flex-1">
            <SumRow icon={<Clock size={14} />} label="Positionen" value={result.positionsTotal} />
            <SumRow icon={<Euro size={14} />} label="Zusätzliche Kosten" value={result.extraTotal} />
            <div className="h-px bg-line" />
            <SumRow label="Zwischensumme" value={result.subtotal} bold />
            {discountCents > 0 && <SumRow label="Rabatt" value={-discountCents} tone="danger" />}
            {bufferPct > 0 && <SumRow label={`Puffer (+${bufferPct}%)`} value={result.withBuffer - result.afterDiscount} tone="warning" />}
            <div className="h-px bg-line" />
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-semibold text-ink-900">Gesamtpreis</span>
              <span className="font-display text-2xl font-medium text-accent-700 tabular-nums">{formatMoney(result.withBuffer)}</span>
            </div>
            <div className="flex items-center justify-between text-2xs text-ink-500">
              <span>Ø Stundensatz</span>
              <span className="tabular-nums">
                {result.totalHours > 0 ? formatMoney(Math.round(result.withBuffer / result.totalHours)) : '—'} / h
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SumRow({ icon, label, value, bold, tone }: { icon?: React.ReactNode; label: string; value: number; bold?: boolean; tone?: 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'text-danger-600' : tone === 'warning' ? 'text-warning-600' : 'text-ink-900';
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm flex items-center gap-1.5 ${bold ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
        {icon}{label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${color}`}>{formatMoney(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewCalcModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: ProjectPriceCalc) => void }) {
  const [label, setLabel] = useState('');
  const [clientName, setClientName] = useState('');

  async function create() {
    const id = await uuid();
    const calc: ProjectPriceCalc = {
      id, label: label || null, client_name: clientName || null,
      positions_json: '[]', extra_costs_json: '[]',
      discount_cents: 0, buffer_pct: 0,
      subtotal_cents: 0, total_cents: 0, total_hours: 0,
      notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    await priceCalcs.insert(calc);
    setLabel(''); setClientName('');
    onClose();
    onCreated(calc);
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Kalkulation" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={create} className="btn-primary">Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Bezeichnung"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z.B. Website Relaunch Müller" autoFocus /></Field>
        <Field label="Kundin (optional)"><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
