import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, Save, FileText, GripVertical, Euro, Clock, Pencil
} from 'lucide-react';
import { priceCalcs, projects, uuid, run, all } from '../lib/db'; // 'all' importiert, um Tabellen-Infos zu prüfen
import type { ProjectPriceCalc, PricePosition, ExtraCost, Project } from '../types';
import { formatMoney, formatDate, parseMoneyToCents } from '../lib/format';
import { EmptyState, Field, Modal, SectionHeader } from '../components/ui';

export function ProjectCalculatorView() {
  const [list, setList] = useState<ProjectPriceCalc[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [editing, setEditing] = useState<ProjectPriceCalc | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    // PRÜFUNG: Erst fragen wir ab, ob die Spalte schon da ist
    const tableInfo = await all<any>("PRAGMA table_info(project_price_calcs)").catch(() => []);
    const hasCol = tableInfo.some(c => c.name === 'project_id');

    // Nur ausführen, wenn die Spalte tatsächlich noch fehlt
    if (!hasCol) {
      await run("ALTER TABLE project_price_calcs ADD COLUMN project_id TEXT;").catch(() => {
        // Fallback-Sicherung
      });
    }

    setList(await priceCalcs.list());
    setProjectList(await projects.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  if (editing) {
    return <CalcEditor calc={editing} projects={projectList} onBack={() => { setEditing(null); load(); }} />;
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
            {list.map(c => {
              const linkedProj = projectList.find(p => p.id === (c as any).project_id);
              return (
                <div
                  key={c.id}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-surfaceAlt/50 transition-colors text-left group"
                >
                  <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900">{c.label || 'Unbenannte Kalkulation'}</p>
                    <p className="text-2xs text-ink-500 mt-1">
                      {linkedProj ? `Projekt: ${linkedProj.name}` : (c.client_name || 'Keine Kundin')} · {formatDate(c.created_at)} · {c.total_hours.toFixed(1)} h
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-ink-900 tabular-nums shrink-0 mr-2">{formatMoney(c.total_cents)}</span>
                  
                  {/* Aktionen auf der rechten Seite */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Bearbeiten-Button (Stift) */}
                    <button 
                      onClick={() => setEditing(c)} 
                      className="p-1.5 rounded-md hover:bg-surfaceMuted text-ink-400 hover:text-accent-600 transition-all"
                      title="Bearbeiten"
                    >
                      <Pencil size={15} />
                    </button>

                    {/* Löschen-Button (Mülleimer) direkt in der Übersicht */}
                    <button 
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm('Kalkulation wirklich unwiderruflich löschen?')) {
                          await priceCalcs.remove(c.id);
                          load(); // Liste aktualisieren
                        }
                      }} 
                      className="p-1.5 rounded-md hover:bg-danger-50 text-ink-400 hover:text-danger-600 transition-all"
                      title="Löschen"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NewCalcModal open={showNew} onClose={() => setShowNew(false)} projects={projectList} onCreated={(c) => setEditing(c)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function CalcEditor({ calc, projects: projectList, onBack }: { calc: ProjectPriceCalc; projects: Project[]; onBack: () => void }) {
  const [label, setLabel] = useState(calc.label || '');
  const [clientName, setClientName] = useState(calc.client_name || '');
  const [projectId, setProjectId] = useState((calc as any).project_id || '');
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
      project_id: projectId || null,
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

  async function handleDelete() {
    if (!confirm('Kalkulation wirklich unwiderruflich löschen?')) return;
    await priceCalcs.remove(calc.id);
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
            <div className="flex items-center gap-3">
              <input
                className="input !border-transparent !bg-transparent !px-0 text-sm text-ink-500 w-auto"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Kundin (optional)"
              />
              <span className="text-ink-300">·</span>
              <select
                className="text-xs bg-transparent border-0 text-accent-600 font-medium focus:outline-none cursor-pointer"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  const p = projectList.find(x => x.id === e.target.value);
                  if (p) setClientName(p.client_name || '');
                }}
              >
                <option value="">— Kein Projekt verknüpft —</option>
                {projectList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button onClick={handleDelete} className="btn-danger text-sm">
              <Trash2 size={15} /> Löschen
            </button>
            <button onClick={save} className="btn-primary">
              <Save size={15} /> Speichern
            </button>
          </div>
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

function NewCalcModal({ open, onClose, projects, onCreated }: { open: boolean; onClose: () => void; projects: Project[]; onCreated: (c: ProjectPriceCalc) => void }) {
  const [label, setLabel] = useState('');
  const [projectId, setProjectId] = useState('');
  const [clientName, setClientName] = useState('');

  async function create() {
    if (!label.trim()) return;
    const id = await uuid();
    const calc: ProjectPriceCalc = {
      id, 
      label: label.trim(), 
      client_name: clientName || null,
      positions_json: '[]', 
      extra_costs_json: '[]',
      discount_cents: 0, 
      buffer_pct: 0,
      subtotal_cents: 0, 
      total_cents: 0, 
      total_hours: 0,
      notes: null, 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString(),
    };
    
    if (projectId) {
      (calc as any).project_id = projectId;
    }

    await priceCalcs.insert(calc);
    setLabel(''); setClientName(''); setProjectId('');
    onClose();
    onCreated(calc);
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Kalkulation" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={create} className="btn-primary" disabled={!label.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Projekt verknüpfen (optional)">
          <select 
            className="input" 
            value={projectId} 
            onChange={(e) => {
              const pid = e.target.value;
              setProjectId(pid);
              const p = projects.find(x => x.id === pid);
              if (p) {
                setClientName(p.client_name || '');
                if (!label) setLabel(`Kalkulation: ${p.name}`);
              }
            }}
          >
            <option value="">— Kein Projekt verknüpfen —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        
        <Field label="Bezeichnung"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z.B. Website Relaunch Müller" autoFocus /></Field>
        <Field label="Kundin (optional)"><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}