import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Building2,
  ExternalLink,
  AlertCircle,
  Calendar,
  RefreshCw,
  Pencil,
} from 'lucide-react';

import { suppliers, uuid } from '../lib/db';
import type { Supplier } from '../types';
import { formatMoney, formatDate, daysUntil } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

const CATEGORY_LABELS: Record<string, string> = {
  hosting: 'Hosting',
  software: 'Software',
  hardware: 'Hardware',
  service: 'Service',
};

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function SuppliersView() {
  const [list, setList] = useState<Supplier[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    setList(await suppliers.list());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm('Lieferant wirklich löschen?')) return;
    await suppliers.remove(id);
    load();
  }

  async function toggleActive(s: Supplier) {
    await suppliers.update(s.id, { active: s.active ? 0 : 1 });
    load();
  }

  // Kündigungsvormerkung direkt in der Liste toggeln
  async function toggleCancelIntended(s: Supplier) {
    const nextVal = (s as any).cancel_intended ? 0 : 1;
    await suppliers.update(s.id, { cancel_intended: nextVal });
    load();
  }

  const active = list.filter(s => s.active);

  const monthlyTotal = active.reduce((s, sup) => {
    if (sup.billing_cycle === 'monthly') return s + sup.monthly_cost_cents;
    if (sup.billing_cycle === 'yearly') return s + Math.round(sup.monthly_cost_cents / 12);
    return s;
  }, 0);

  const yearlyTotal = active.reduce((s, sup) => {
    if (sup.billing_cycle === 'yearly') return s + sup.monthly_cost_cents;
    if (sup.billing_cycle === 'monthly') return s + sup.monthly_cost_cents * 12;
    return s;
  }, 0);

  // Kündigungs-Assistent Logik
  const upcomingCancellations = active.map(s => {
    if (!s.contract_end_date) return null;
    const latestCancelDate = subtractDays(s.contract_end_date, s.notice_period_days || 0);
    const daysLeft = daysUntil(latestCancelDate);
    return { supplier: s, latestCancelDate, daysLeft };
  }).filter((item): item is { supplier: Supplier; latestCancelDate: string; daysLeft: number } => {
    if (item === null || item.daysLeft === null) return false;
    // Zeige an, wenn die Kündigung aktiv vorgemerkt ist (solange Frist in der Zukunft liegt)
    if ((item.supplier as any).cancel_intended === 1 && item.daysLeft >= 0) return true;
    // ODER wenn die Frist regulär kurz bevorsteht (14 Tage)
    return item.daysLeft <= 14 && item.daysLeft >= 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">
            Tool-Abos & Lieferanten
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {active.length} aktiv · {formatMoney(monthlyTotal)}/Monat · {formatMoney(yearlyTotal)}/Jahr
          </p>
        </div>

        <button
          onClick={() => {
            setEditingSupplier(null);
            setShowAdd(true);
          }}
          className="btn-primary"
        >
          <Plus size={16} /> Neuer Eintrag
        </button>
      </div>

      {/* DYNAMISCHER KÜNDIGUNGS-ASSISTENT */}
      {upcomingCancellations.length > 0 && (
        <div className="card p-4 bg-warning-50/50 dark:bg-warning-50/20 border border-warning-500/30 rounded-xl">
          <div className="flex items-center gap-2 mb-2.5">
            <AlertCircle size={16} className="text-warning-600 dark:text-warning-500 shrink-0" />
            <p className="text-sm font-semibold text-warning-800 dark:text-warning-400">
              Kündigungs-Assistent: {upcomingCancellations.length} Vertrag/Verträge im Fokus
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {upcomingCancellations.map(c => {
              const isManual = (c.supplier as any).cancel_intended === 1;
              return (
                <span key={c.supplier.id} className="chip bg-surface border border-warning-500/20 text-warning-700 dark:text-warning-300 text-2xs px-2.5 py-1.5 flex items-center gap-1.5 shadow-sm rounded-lg">
                  <Calendar size={11} className="text-warning-500" />
                  <span>
                    {isManual && (
                      <span className="text-[10px] bg-danger-500 text-white dark:bg-danger-600 px-1.5 py-0.5 rounded font-bold mr-1.5 uppercase tracking-wide">
                        Kündigen!
                      </span>
                    )}
                    <strong>{c.supplier.name}</strong> · Stichtag am <b>{formatDate(c.latestCancelDate)}</b> ({c.daysLeft === 0 ? 'heute!' : c.daysLeft === 1 ? 'morgen' : `in ${c.daysLeft} Tagen`})
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-5">
        <SectionHeader title="Alle Einträge" />

        {list.length === 0 ? (
          <EmptyState
            icon={<Building2 size={24} />}
            title="Keine Lieferanten"
            hint="Erfasse Hosting, Software-Abos und andere wiederkehrende Kosten."
          />
        ) : (
          <div className="divide-y divide-line">
            {list.map(s => {
              const latestCancelDate = s.contract_end_date ? subtractDays(s.contract_end_date, s.notice_period_days || 0) : null;
              const daysLeft = latestCancelDate ? daysUntil(latestCancelDate) : null;
              const isCancellationClose = daysLeft !== null && daysLeft <= 14 && daysLeft >= 0;
              const cancelIntended = (s as any).cancel_intended === 1;

              return (
                <div key={s.id} className="flex items-center gap-3 py-3 group">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      s.active
                        ? 'bg-accent-50 text-accent-600'
                        : 'bg-surfaceMuted text-ink-400'
                    }`}
                  >
                    <Building2 size={16} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{s.name}</p>

                    <p className="text-2xs text-ink-500">
                      {s.category ? CATEGORY_LABELS[s.category] || s.category : 'Sonstige'}
                      {s.billing_cycle === 'monthly'
                        ? ` · ${formatMoney(s.monthly_cost_cents)}/Monat`
                        : s.billing_cycle === 'yearly'
                        ? ` · ${formatMoney(s.monthly_cost_cents)}/Jahr`
                        : ` · ${formatMoney(s.monthly_cost_cents)}`}
                      {s.notice_period_days > 0 && ` · Künd. ${s.notice_period_days}T`}
                    </p>
                  </div>

                  {/* Kündigungs-Status-Badges */}
                  {s.active === 1 && (
                    <div className="flex gap-1">
                      {cancelIntended && (
                        <Badge tone="danger">Kündigung geplant</Badge>
                      )}
                      {latestCancelDate && isCancellationClose && (
                        <Badge tone="warning">⚠️ Frist: {formatDate(latestCancelDate)}</Badge>
                      )}
                    </div>
                  )}

                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-ink-400 hover:text-accent-600"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}

                  <button
                    onClick={() => toggleActive(s)}
                    className={`chip text-2xs ${
                      s.active
                        ? 'bg-success-50 text-success-700'
                        : 'bg-surfaceMuted text-ink-500'
                    }`}
                  >
                    {s.active ? 'Aktiv' : 'Inaktiv'}
                  </button>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    
                    {/* Vormerkungs-Glocke */}
                    {s.active === 1 && (
                      <button
                        onClick={() => toggleCancelIntended(s)}
                        className={`p-1 rounded ${cancelIntended ? 'text-danger-600' : 'text-ink-400 hover:text-warning-500'}`}
                        title={cancelIntended ? "Kündigungsvormerkung entfernen" : "Zur Kündigung vormerken"}
                      >
                        <AlertCircle size={14} className={cancelIntended ? "fill-danger-500/10 text-danger-500" : ""} />
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setEditingSupplier(s);
                        setShowAdd(true);
                      }}
                      className="p-1 text-ink-400 hover:text-accent-600"
                      title="Bearbeiten"
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      onClick={() => remove(s.id)}
                      className="p-1 text-ink-400 hover:text-danger-600"
                      title="Löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddSupplierModal
        open={showAdd}
        supplier={editingSupplier}
        onAdded={() => {
          load();
          setEditingSupplier(null);
        }}
        onClose={() => {
          setShowAdd(false);
          setEditingSupplier(null);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function AddSupplierModal({
  open,
  onAdded,
  onClose,
  supplier,
}: {
  open: boolean;
  onAdded: () => void;
  onClose: () => void;
  supplier: Supplier | null;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('software');
  const [cost, setCost] = useState('');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [noticeDays, setNoticeDays] = useState('30');
  const [endDate, setEndDate] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [cancelIntended, setCancelIntended] = useState(0);
  const [firstDate, setFirstDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  });

  const isEditing = !!supplier;

  useEffect(() => {
    if (supplier) {
      setName(supplier.name);
      setCategory(supplier.category || 'software');
      setCost((supplier.monthly_cost_cents / 100).toString());
      setCycle(supplier.billing_cycle === 'yearly' ? 'yearly' : 'monthly');
      setNoticeDays(String(supplier.notice_period_days || 0));
      setEndDate(supplier.contract_end_date || '');
      setUrl(supplier.url || '');
      setNotes(supplier.notes || '');
      setCancelIntended((supplier as any).cancel_intended || 0);
    } else {
      setName('');
      setCategory('software');
      setCost('');
      setCycle('monthly');
      setNoticeDays('30');
      setEndDate('');
      setUrl('');
      setNotes('');
      setCancelIntended(0);
      const d = new Date();
      d.setMonth(d.getMonth() + 1, 1);
      setFirstDate(d.toISOString().slice(0, 10));
    }
  }, [supplier, open]);

  async function submit() {
    if (!name.trim()) return;

    const costCents = cost ? Math.round(parseFloat(cost.replace(',', '.')) * 100) : 0;

    const supplierData = {
      name: name.trim(),
      category,
      monthly_cost_cents: costCents,
      billing_cycle: cycle,
      notice_period_days: noticeDays ? parseInt(noticeDays) : 0,
      contract_end_date: endDate || null,
      url: url.trim() || null,
      notes: notes.trim() || null,
      cancel_intended: cancelIntended,
    };

    if (supplier) {
      await suppliers.update(supplier.id, supplierData);
    } else {
      const id = await uuid();

      // Tool & Abo = immer automatisch wiederkehrend.
      await suppliers.insertWithRecurring(
        { id, ...supplierData, active: 1, created_at: new Date().toISOString() },
        true,
        firstDate
      );
    }

    onAdded();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Lieferant bearbeiten' : 'Neuer Lieferant / Abo'}
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Abbrechen
          </button>
          <button
            onClick={submit}
            className="btn-primary"
            disabled={!name.trim()}
          >
            Speichern
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie">
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="hosting">Hosting</option>
              <option value="software">Software</option>
              <option value="hardware">Hardware</option>
              <option value="service">Service</option>
            </select>
          </Field>

          <Field label="Abrechnung">
            <select
              className="input"
              value={cycle}
              onChange={(e) =>
                setCycle(e.target.value as 'monthly' | 'yearly')
              }
            >
              <option value="monthly">Monatlich</option>
              <option value="yearly">Jährlich</option>
            </select>
          </Field>
        </div>

        <Field label="Kosten (€)">
          <input
            className="input"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
          />
        </Field>

        <Field label="Kündigungsfrist (Tage)" hint="z.B. 30 Tage vor Ende der Laufzeit">
          <input
            className="input"
            value={noticeDays}
            onChange={(e) => setNoticeDays(e.target.value)}
          />
        </Field>

        <Field label="Nächste Verlängerung / Vertragsende" hint="Für fortlaufende Abos: Datum der nächsten Abbuchung eintragen.">
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>

        {/* NEUE CHECKBOX FÜR KÜNDIGUNGSVORMERKUNG IM MODAL */}
        <div className="py-1">
          <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
            <input
              type="checkbox"
              checked={cancelIntended === 1}
              onChange={(e) => setCancelIntended(e.target.checked ? 1 : 0)}
              className="rounded border-line text-accent-600 focus:ring-accent-500 h-4 w-4"
            />
            <span className="font-medium text-ink-900">Kündigung aktiv vormerken (Erinnerung immer einblenden)</span>
          </label>
        </div>

        <Field label="URL">
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>

        <Field label="Notizen">
          <textarea
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </Field>

        {!isEditing && (
          <div className="p-3 rounded-lg bg-surfaceAlt/50 space-y-2">
            <p className="text-2xs text-ink-500 flex items-center gap-1.5">
              <RefreshCw size={12} className="text-accent-600" />
              Wird automatisch als wiederkehrende Buchung in den Finanzen angelegt.
            </p>
            <Field label="Erste Fälligkeit">
              <input
                type="date"
                className="input"
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}