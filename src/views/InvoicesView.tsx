import { useEffect, useState, useCallback } from 'react';
import {
  Plus, FileText, CheckCircle, AlertCircle, Clock, Pencil, Download,
  FileSpreadsheet, XCircle, Send, ArchiveRestore
} from 'lucide-react';
import type { Invoice, InvoicePosition, Project, Offer, Transaction, Avv, Client, AvvStatus } from '../types';
import { invoices, offers, projects, transactions, uuid, settings, avvs, clients, documents } from '../lib/db';
import { formatMoney, formatDate, todayISO, daysUntil } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader, MoneyInput } from '../components/ui';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const STATUS_LABELS = {
  open: 'Offen', paid: 'Bezahlt', overdue: 'Überfällig', cancelled: 'Storniert',
} as const;

const AVV_STATUS_LABELS: Record<AvvStatus, string> = {
  draft: 'Entwurf', sent: 'Versendet', signed: 'Unterzeichnet', cancelled: 'Storniert',
};

const AVV_STATUS_TONE: Record<AvvStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral', sent: 'info', signed: 'success', cancelled: 'danger',
};

const DEFAULT_TAX_RATE = 19;

// ---------------------------------------------------------------------------
// Brand palette for PDF exports (Fundament Studio)
// ---------------------------------------------------------------------------
const PDF_COLORS = {
  petrol: [31, 62, 68] as [number, number, number],
  gold: [180, 132, 105] as [number, number, number],
  bordeaux: [115, 56, 67] as [number, number, number],
  ink: [40, 40, 40] as [number, number, number],
  muted: [120, 120, 120] as [number, number, number],
  paleGold: [247, 243, 240] as [number, number, number],
};

export function InvoicesView() {
  const [tab, setTab] = useState<'invoices' | 'avv'>('invoices');

  // Invoices state
  const [list, setList] = useState<Invoice[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [offerList, setOfferList] = useState<Offer[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFromOffer, setShowFromOffer] = useState(false);
  const [filter, setFilter] = useState<'all' | Invoice['status']>('all');

  // AVV state
  const [avvList, setAvvList] = useState<Avv[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [showAddAvv, setShowAddAvv] = useState(false);
  const [avvFilter, setAvvFilter] = useState<'all' | AvvStatus>('all');

  const load = useCallback(async () => {
    setList(await invoices.list());
    setProjectList(await projects.list());
    setOfferList(await offers.list());
    setAvvList(await avvs.list());
    setClientList(await clients.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-mark overdue
  const enriched = list.map(i => {
    if (i.status === 'open' && i.due_date) {
      const days = daysUntil(i.due_date);
      if (days !== null && days < 0) return { ...i, status: 'overdue' as Invoice['status'] };
    }
    return i;
  });

  const filtered = filter === 'all' ? enriched : enriched.filter(i => i.status === filter);

  const totals = {
    open: enriched.filter(i => i.status === 'open' || i.status === 'overdue').reduce((s, i) => s + i.total_cents, 0),
    overdue: enriched.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total_cents, 0),
    paid: enriched.filter(i => i.status === 'paid').reduce((s, i) => s + i.total_cents, 0),
  };

  async function markPaid(inv: Invoice) {
    const txId = await uuid();
    const nowIso = new Date().toISOString();
    await transactions.insert({
      id: txId, type: 'income', amount_cents: inv.total_cents, currency: inv.currency,
      description: `Rechnung ${inv.invoice_number}`, category: 'Rechnung',
      project_id: inv.project_id, transaction_date: todayISO(), created_at: nowIso,
    } as Transaction);
    await invoices.update(inv.id, { status: 'paid', paid_date: todayISO(), paid_transaction_id: txId });
    load();
  }

  async function cancelInvoice(id: string, reason: string) {
    await invoices.cancel(id, reason);
    load();
  }

  // AVV functions
  const filteredAvv = avvFilter === 'all' ? avvList : avvList.filter(a => a.status === avvFilter);

  const avvStats = {
    draft: avvList.filter(a => a.status === 'draft').length,
    sent: avvList.filter(a => a.status === 'sent').length,
    signed: avvList.filter(a => a.status === 'signed').length,
    expiring: avvList.filter(a => a.valid_until && new Date(a.valid_until) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)).length,
  };

  async function markAvvSent(id: string) {
    await avvs.update(id, { status: 'sent', sent_date: todayISO() });
    load();
  }

  async function markAvvSigned(id: string) {
    await avvs.update(id, { status: 'signed', signed_date: todayISO() });
    load();
  }

  async function removeAvv(id: string) {
    if (confirm('AVV wirklich löschen?')) {
      await avvs.remove(id);
      load();
    }
  }

  const openOffers = offerList.filter(o => o.status === 'won' && !list.some(i => i.offer_id === o.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Rechnungen & AVV</h1>
          <p className="text-sm text-ink-500 mt-0.5">Forderungen, Zahlungseingänge und Auftragsverarbeitungsverträge</p>
        </div>
        <div className="flex gap-2">
          {tab === 'invoices' && openOffers.length > 0 && (
            <button onClick={() => setShowFromOffer(true)} className="btn-outline">
              Aus Angebot erstellen
            </button>
          )}
          {tab === 'invoices' && (
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={16} /> Neue Rechnung
            </button>
          )}
          {tab === 'avv' && (
            <button onClick={() => setShowAddAvv(true)} className="btn-primary">
              <Plus size={16} /> Neuer AVV
            </button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg bg-surfaceMuted p-0.5 w-fit">
        <button
          onClick={() => setTab('invoices')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${tab === 'invoices' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          <FileText size={16} /> Rechnungen
        </button>
        <button
          onClick={() => setTab('avv')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${tab === 'avv' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          <FileText size={16} /> AVV
        </button>
      </div>

      {tab === 'invoices' ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryCard label="Offen" value={totals.open} icon={<Clock size={18} />} tone="warning" />
            <SummaryCard label="Überfällig" value={totals.overdue} icon={<AlertCircle size={18} />} tone="danger" />
            <SummaryCard label="Bezahlt (gesamt)" value={totals.paid} icon={<CheckCircle size={18} />} tone="success" />
          </div>

          {/* Filter + Export */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {(['all', 'open', 'overdue', 'paid', 'cancelled'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`chip transition-colors ${filter === f ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
                >
                  {f === 'all' ? 'Alle' : STATUS_LABELS[f]}
                </button>
              ))}
            </div>
            <button onClick={() => exportEueR(enriched)} className="btn-ghost text-sm">
              <FileSpreadsheet size={14} /> EüR-Export
            </button>
          </div>

          {/* List */}
          <div className="card p-5">
            <SectionHeader title={filter === 'all' ? 'Alle Rechnungen' : STATUS_LABELS[filter]} />
            {filtered.length === 0 ? (
              <EmptyState icon={<FileText size={24} />} title="Keine Rechnungen" hint="Erfasse eine neue Rechnung oder erstelle aus einem gewonnenen Angebot." />
            ) : (
              <div className="divide-y divide-line">
                {filtered.map(inv => {
                  const project = projectList.find(p => p.id === inv.project_id);
                  const days = daysUntil(inv.due_date);
                  return (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      project={project}
                      daysOverdue={days !== null && days < 0 ? Math.abs(days) : null}
                      onMarkPaid={() => markPaid(inv)}
                      onCancel={(reason) => cancelInvoice(inv.id, reason)}
                      onEdit={() => load()}
                      onRefresh={load}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <AddInvoiceModal open={showAdd} onClose={() => setShowAdd(false)} projects={projectList} clients={clientList ?? []} onCreated={load} />
          <InvoiceFromOfferModal open={showFromOffer} onClose={() => setShowFromOffer(false)} offers={openOffers} onCreated={load} />
        </>
      ) : (
        <>
          {/* AVV Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Entwurf" value={avvStats.draft} icon={<FileText size={16} />} tone="neutral" />
            <StatCard label="Versendet" value={avvStats.sent} icon={<Send size={16} />} tone="info" />
            <StatCard label="Unterzeichnet" value={avvStats.signed} icon={<CheckCircle size={16} />} tone="success" />
            <StatCard label="Läuft bald ab" value={avvStats.expiring} icon={<Clock size={16} />} tone="warning" />
          </div>

          {/* AVV Filter */}
          <div className="flex gap-2">
            {(['all', 'draft', 'sent', 'signed', 'cancelled'] as const).map(f => (
              <button
                key={f}
                onClick={() => setAvvFilter(f)}
                className={`chip transition-colors ${avvFilter === f ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
              >
                {f === 'all' ? 'Alle' : AVV_STATUS_LABELS[f]}
              </button>
            ))}
          </div>

          {/* AVV List */}
          <div className="card p-5">
            <SectionHeader title={avvFilter === 'all' ? 'Alle AVV' : AVV_STATUS_LABELS[avvFilter]} />
            {filteredAvv.length === 0 ? (
              <EmptyState icon={<FileText size={24} />} title="Keine AVV" hint="Erstelle einen neuen Auftragsverarbeitungsvertrag." />
            ) : (
              <div className="divide-y divide-line">
                {filteredAvv.map(avv => (
                  <AvvRow
                    key={avv.id}
                    avv={avv}
                    onMarkSent={() => markAvvSent(avv.id)}
                    onMarkSigned={() => markAvvSigned(avv.id)}
                    onRemove={() => removeAvv(avv.id)}
                    onEdit={load}
                  />
                ))}
              </div>
            )}
          </div>

          <AddAvvModal open={showAddAvv} onClose={() => setShowAddAvv(false)} clients={clientList} onCreated={load} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'warning' | 'danger' | 'success' }) {
  const tones = {
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
    success: 'bg-success-50 text-success-600',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${tones[tone]}`}>{icon}</div>
        <div>
          <p className="text-2xs font-medium text-ink-500">{label}</p>
          <p className="stat-value">{formatMoney(value)}</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: 'neutral' | 'info' | 'success' | 'warning' }) {
  const bg = { neutral: 'bg-surfaceMuted', info: 'bg-info-50', success: 'bg-success-50', warning: 'bg-warning-50' }[tone];
  const txt = { neutral: 'text-ink-600', info: 'text-info-600', success: 'text-success-600', warning: 'text-warning-600' }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg} ${txt}`}>{icon}</div>
        <div>
          <p className="text-2xs font-medium text-ink-500">{label}</p>
          <p className="text-xl font-semibold text-ink-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Row
// ---------------------------------------------------------------------------

function InvoiceRow({ invoice, project, daysOverdue, onMarkPaid, onCancel, onEdit, onRefresh }: {
  invoice: Invoice;
  project?: Project;
  daysOverdue: number | null;
  onMarkPaid: () => void;
  onCancel: (reason: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 py-3 group">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
          invoice.status === 'paid' ? 'bg-success-50 text-success-600' :
          invoice.status === 'overdue' ? 'bg-danger-50 text-danger-600' :
          invoice.status === 'cancelled' ? 'bg-surfaceMuted text-ink-400' :
          'bg-surfaceMuted text-ink-500'
        }`}>
          <FileText size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{invoice.invoice_number}</p>
          <p className="text-2xs text-ink-500 truncate">
            {invoice.client_name}
            {project && ` · ${project.name}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums">{formatMoney(invoice.total_cents)}</p>
          <p className="text-2xs text-ink-500">{formatDate(invoice.issued_date)}</p>
        </div>
        <Badge tone={invoice.status === 'overdue' ? 'danger' : invoice.status === 'paid' ? 'success' : 'neutral'}>
          {STATUS_LABELS[invoice.status]}
        </Badge>
        <div className="flex items-center gap-1">
          <button onClick={() => generatePdf(invoice, 'download')} className="btn-ghost text-2xs px-2 py-1" title="PDF herunterladen">
            <Download size={13} />
          </button>
          <button onClick={() => generatePdf(invoice, 'archive')} className="btn-ghost text-2xs px-2 py-1 text-ink-500 hover:text-accent-600" title="Ins Archiv kopieren">
            <ArchiveRestore size={13} />
          </button>
          {invoice.status === 'open' && (
            <button onClick={onMarkPaid} className="btn-ghost text-2xs px-2 py-1 text-success-600" title="Als bezahlt markieren">
              <CheckCircle size={13} />
            </button>
          )}
          {(invoice.status === 'open' || invoice.status === 'overdue') && !confirming && (
            <button onClick={() => setConfirming(true)} className="btn-ghost text-2xs px-2 py-1 text-danger-600" title="Stornieren">
              <XCircle size={13} />
            </button>
          )}
          {invoice.status !== 'cancelled' && (
            <button onClick={() => setEditing(true)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100" title="Bearbeiten">
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="pl-12 pb-3">
          <ConfirmCancel onConfirm={(reason) => { onCancel(reason); setConfirming(false); }} onCancel={() => setConfirming(false)} />
        </div>
      )}

      {editing && (
        <EditInvoiceModal invoice={invoice} onClose={() => setEditing(false)} onSaved={() => { onEdit(); setEditing(false); }} />
      )}
    </>
  );
}

function ConfirmCancel({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="flex items-center gap-2 text-sm bg-danger-50 p-2 rounded-lg">
      <span className="text-ink-700">Grund:</span>
      <input className="input flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z.B. Doppelte Rechnung" />
      <button onClick={() => onConfirm(reason || 'Storniert')} className="btn-danger text-xs">Stornieren</button>
      <button onClick={onCancel} className="btn-ghost text-xs">Abbrechen</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Modals
// ---------------------------------------------------------------------------

function AddInvoiceModal({
  open,
  onClose,
  projects,
  clients,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  clients: Client[];
  onCreated: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [client, setClient] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');

  const [positions, setPositions] = useState<InvoicePosition[]>([
    {
      description: '',
      quantity: 1,
      unit: 'St.',
      unit_price_cents: 0,
      total_cents: 0,
      tax_rate_pct: DEFAULT_TAX_RATE,
    },
  ]);

  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE);
  const [issued, setIssued] = useState(todayISO());
  const [due, setDue] = useState('');
  const [avv, setAvv] = useState(false);
  const [notes, setNotes] = useState('');

  const subtotal = positions.reduce((s, p) => s + p.total_cents, 0);
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const total = subtotal + taxAmount;

  function updatePosition(idx: number, fields: Partial<InvoicePosition>) {
    const next = [...positions];
    next[idx] = { ...next[idx], ...fields };
    const pos = next[idx];
    pos.total_cents = Math.round(pos.quantity * pos.unit_price_cents);
    setPositions(next);
  }

  function addPosition() {
    setPositions([
      ...positions,
      {
        description: '',
        quantity: 1,
        unit: 'St.',
        unit_price_cents: 0,
        total_cents: 0,
        tax_rate_pct: taxRate,
      },
    ]);
  }

  function removePosition(idx: number) {
    setPositions(positions.filter((_, i) => i !== idx));
  }

  function fillFromProject(pid: string) {
    const p = projects.find((x) => x.id === pid);
    if (!p) return;

    setClient(p.client_name || '');
    setCompany(p.client_company || '');
    setAddress(p.client_address || '');
    setEmail(p.client_email || '');
  }

  function fillFromClient(cid: string) {
    const c = clients.find((x) => x.id === cid);
    if (!c) return;

    setClient(c.name || '');
    setCompany(c.company || '');
    setAddress(c.address || '');
    setEmail(c.email || '');
  }

  async function submit() {
    if (!client.trim() || positions.every((p) => !p.description.trim())) return;

    const year = new Date().getFullYear();
    const invoiceNumber = await invoices.nextNumber(year);

    const id = await uuid();

    await invoices.insert({
      id,
      project_id: projectId || null,
      offer_id: null,
      invoice_number: invoiceNumber,
      client_name: client.trim(),
      client_company: company.trim() || null,
      client_address: address.trim() || null,
      client_email: email.trim() || null,
      positions_json: JSON.stringify(
        positions.filter((p) => p.description.trim())
      ),
      subtotal_cents: subtotal,
      tax_rate_pct: taxRate,
      tax_amount_cents: taxAmount,
      total_cents: total,
      currency: 'EUR',
      status: 'open',
      issued_date: issued,
      due_date: due || null,
      paid_date: null,
      paid_transaction_id: null,
      cancelled_at: null,
      cancel_reason: null,
      original_invoice_id: null,
      avv_accepted: avv ? 1 : 0,
      avv_accepted_at: avv ? todayISO() : null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Invoice);

    setClientId('');
    setClient('');
    setCompany('');
    setAddress('');
    setEmail('');
    setProjectId('');
    setPositions([
      {
        description: '',
        quantity: 1,
        unit: 'St.',
        unit_price_cents: 0,
        total_cents: 0,
        tax_rate_pct: DEFAULT_TAX_RATE,
      },
    ]);
    setTaxRate(DEFAULT_TAX_RATE);
    setDue('');
    setAvv(false);
    setNotes('');

    onCreated();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neue Rechnung"
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Abbrechen
          </button>
          <button
            onClick={submit}
            className="btn-primary"
            disabled={!client.trim()}
          >
            Erstellen
          </button>
        </>
      }
    >
      <div className="space-y-4">

        {/* CLIENT SELECT */}
        <Field label="Kunde auswählen (optional)">
          <select
            className="input"
            value={clientId}
            onChange={(e) => {
              const id = e.target.value;
              setClientId(id);
              fillFromClient(id);
            }}
          >
            <option value="">— manuell eingeben —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` (${c.company})` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Kunde">
            <input
              className="input"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Name"
              autoFocus
            />
          </Field>

          <Field label="Firma (optional)">
            <input
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Adresse (optional)">
          <textarea
            className="input min-h-[60px]"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="E-Mail (optional)">
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Projekt (optional)">
            <select
              className="input"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                fillFromProject(e.target.value);
              }}
            >
              <option value="">— Kein Projekt —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* POSITIONEN */}
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink-700 mb-3">
            Positionen
          </h3>

          {positions.map((pos, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 mb-2 items-end"
            >
              <input
                className="input col-span-5"
                placeholder="Beschreibung"
                value={pos.description}
                onChange={(e) =>
                  updatePosition(idx, { description: e.target.value })
                }
              />

              <input
                type="number"
                className="input col-span-1"
                value={pos.quantity}
                onChange={(e) =>
                  updatePosition(idx, {
                    quantity: parseFloat(e.target.value) || 0,
                  })
                }
              />

              <select
                className="input col-span-2"
                value={pos.unit}
                onChange={(e) =>
                  updatePosition(idx, { unit: e.target.value })
                }
              >
                <option value="St.">St.</option>
                <option value="Std.">Std.</option>
                <option value="Tag">Tag</option>
                <option value="Monat">Monat</option>
              </select>

              <MoneyInput
                valueCents={pos.unit_price_cents}
                onChange={(cents) =>
                  updatePosition(idx, { unit_price_cents: cents })
                }
                placeholder="Einzelpreis"
                className="input col-span-2"
              />

              <span className="input col-span-1 text-right tabular-nums">
                {formatMoney(pos.total_cents)}
              </span>

              {positions.length > 1 && (
                <button
                  onClick={() => removePosition(idx)}
                  className="btn-ghost text-danger-600 px-2"
                >
                  <XCircle size={14} />
                </button>
              )}
            </div>
          ))}

          <button onClick={addPosition} className="btn-ghost text-sm mt-1">
            <Plus size={14} /> Position hinzufügen
          </button>
        </div>

        {/* TAX */}
        <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Field label="USt. %">
            <input
              type="number"
              className="input"
              value={taxRate}
              onChange={(e) =>
                setTaxRate(parseFloat(e.target.value) || 0)
              }
            />
          </Field>

          <div className="text-right">
            <p className="text-2xs text-ink-500">Zwischensumme</p>
            <p className="text-sm font-medium">
              {formatMoney(subtotal)}
            </p>
          </div>

          <div className="text-right">
            <p className="text-2xs text-ink-500">USt.</p>
            <p className="text-sm font-medium">
              {formatMoney(taxAmount)}
            </p>
          </div>
        </div>

        <div className="text-right text-lg font-semibold">
          Gesamt: {formatMoney(total)}
        </div>

        {/* DATES */}
        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Rechnungsdatum">
            <input
              type="date"
              className="input"
              value={issued}
              onChange={(e) => setIssued(e.target.value)}
            />
          </Field>

          <Field label="Fällig bis">
            <input
              type="date"
              className="input"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        </div>

        {/* AVV */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={avv}
            onChange={(e) => setAvv(e.target.checked)}
          />
          <label className="text-sm">
            AVV wurde akzeptiert
          </label>
        </div>

        <Field label="Notizen">
          <textarea
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </Field>
      </div>
    </Modal>
  );
}

function EditInvoiceModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState(invoice.client_name);
  const [company, setCompany] = useState(invoice.client_company || '');
  const [address, setAddress] = useState(invoice.client_address || '');
  const [email, setEmail] = useState(invoice.client_email || '');
  const [positions, setPositions] = useState<InvoicePosition[]>(JSON.parse(invoice.positions_json || '[]'));
  const [taxRate, setTaxRate] = useState(invoice.tax_rate_pct);
  const [due, setDue] = useState(invoice.due_date || '');
  const [notes, setNotes] = useState(invoice.notes || '');

  const subtotal = positions.reduce((s, p) => s + p.total_cents, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100);
  const total = subtotal + taxAmount;

  function updatePosition(idx: number, fields: Partial<InvoicePosition>) {
    const next = [...positions];
    next[idx] = { ...next[idx], ...fields };
    const pos = next[idx];
    pos.total_cents = Math.round(pos.quantity * pos.unit_price_cents);
    setPositions(next);
  }

  function addPosition() {
    setPositions([...positions, { description: '', quantity: 1, unit: 'St.', unit_price_cents: 0, total_cents: 0, tax_rate_pct: taxRate }]);
  }

  function removePosition(idx: number) {
    setPositions(positions.filter((_, i) => i !== idx));
  }

  async function save() {
    await invoices.update(invoice.id, {
      client_name: client.trim(),
      client_company: company.trim() || null,
      client_address: address.trim() || null,
      client_email: email.trim() || null,
      positions_json: JSON.stringify(positions.filter(p => p.description.trim())),
      subtotal_cents: subtotal,
      tax_rate_pct: taxRate,
      tax_amount_cents: taxAmount,
      total_cents: total,
      due_date: due || null,
      notes: notes.trim() || null,
    });
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Rechnung bearbeiten" size="lg"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={save} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kunde"><input className="input" value={client} onChange={(e) => setClient(e.target.value)} /></Field>
          <Field label="Firma"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><textarea className="input min-h-[60px]" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="E-Mail"><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink-700 mb-3">Positionen</h3>
          {positions.map((pos, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <input className="input col-span-5" placeholder="Beschreibung" value={pos.description} onChange={(e) => updatePosition(idx, { description: e.target.value })} />
              <input type="number" className="input col-span-1" value={pos.quantity} onChange={(e) => updatePosition(idx, { quantity: parseFloat(e.target.value) || 0 })} />
              <select className="input col-span-2" value={pos.unit} onChange={(e) => updatePosition(idx, { unit: e.target.value })}>
                <option value="St.">St.</option>
                <option value="Std.">Std.</option>
                <option value="Tag">Tag</option>
                <option value="Monat">Monat</option>
              </select>
              <MoneyInput valueCents={pos.unit_price_cents} onChange={(cents) => updatePosition(idx, { unit_price_cents: cents })} placeholder="Einzelpreis" className="input col-span-2" />
              <span className="input col-span-1 text-right text-ink-500 tabular-nums">{formatMoney(pos.total_cents)}</span>
              {positions.length > 1 && <button onClick={() => removePosition(idx)} className="btn-ghost text-danger-600 px-2"><XCircle size={14} /></button>}
            </div>
          ))}
          <button onClick={addPosition} className="btn-ghost text-sm mt-1"><Plus size={14} /> Position hinzufügen</button>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Field label="USt. %"><input type="number" className="input" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} /></Field>
          <div className="text-right"><p className="text-2xs text-ink-500">Zwischensumme</p><p className="text-sm font-medium">{formatMoney(subtotal)}</p></div>
          <div className="text-right"><p className="text-2xs text-ink-500">USt.</p><p className="text-sm font-medium">{formatMoney(taxAmount)}</p></div>
        </div>
        <div className="text-right text-lg font-semibold text-ink-900">Gesamt: {formatMoney(total)}</div>

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Fällig bis"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>

        <Field label="Notizen"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}

function InvoiceFromOfferModal({ open, onClose, offers, onCreated }: {
  open: boolean;
  onClose: () => void;
  offers: Offer[];
  onCreated: () => void;
}) {
  const [selectedOffer, setSelectedOffer] = useState('');
  const [positions, setPositions] = useState<InvoicePosition[]>([]);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE);
  const [issued, setIssued] = useState(todayISO());
  const [due, setDue] = useState('');
  const [avv, setAvv] = useState(false);

  const offer = offers.find(o => o.id === selectedOffer);
  const subtotal = positions.reduce((s, p) => s + p.total_cents, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100);
  const total = subtotal + taxAmount;

  useEffect(() => {
    if (selectedOffer && offer) {
      setPositions([{
        description: offer.title,
        quantity: 1,
        unit: 'Pauschal',
        unit_price_cents: offer.estimated_value_cents || 0,
        total_cents: offer.estimated_value_cents || 0,
        tax_rate_pct: taxRate,
      }]);
    }
  }, [selectedOffer]);

  function updatePosition(idx: number, fields: Partial<InvoicePosition>) {
    const next = [...positions];
    next[idx] = { ...next[idx], ...fields };
    const pos = next[idx];
    pos.total_cents = Math.round(pos.quantity * pos.unit_price_cents);
    setPositions(next);
  }

  async function submit() {
    if (!selectedOffer || positions.length === 0) return;

    const year = new Date().getFullYear();
    const invoiceNumber = await invoices.nextNumber(year);

    const id = await uuid();
    await invoices.insert({
      id,
      project_id: offer?.project_id || null,
      offer_id: selectedOffer,
      invoice_number: invoiceNumber,
      client_name: offer?.client_name || '',
      client_company: offer?.client_company || null,
      client_address: offer?.client_address || null,
      client_email: offer?.client_email || null,
      positions_json: JSON.stringify(positions),
      subtotal_cents: subtotal,
      tax_rate_pct: taxRate,
      tax_amount_cents: taxAmount,
      total_cents: total,
      currency: 'EUR',
      status: 'open',
      issued_date: issued,
      due_date: due || null,
      paid_date: null,
      paid_transaction_id: null,
      cancelled_at: null,
      cancel_reason: null,
      original_invoice_id: null,
      avv_accepted: avv ? 1 : 0,
      avv_accepted_at: avv ? todayISO() : null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Invoice);

    setSelectedOffer('');
    setPositions([]);
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Rechnung aus Angebot" size="lg"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary" disabled={!selectedOffer}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Angebot">
          <select className="input" value={selectedOffer} onChange={(e) => setSelectedOffer(e.target.value)}>
            <option value="">— Angebot wählen —</option>
            {offers.map(o => <option key={o.id} value={o.id}>{o.title} ({o.client_name})</option>)}
          </select>
        </Field>

        {offer && (
          <>
            <div className="border-t border-line pt-4">
              <h3 className="text-sm font-medium text-ink-700 mb-3">Positionen</h3>
              {positions.map((pos, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-end">
                  <input className="input col-span-5" placeholder="Beschreibung" value={pos.description} onChange={(e) => updatePosition(idx, { description: e.target.value })} />
                  <input type="number" className="input col-span-1" value={pos.quantity} onChange={(e) => updatePosition(idx, { quantity: parseFloat(e.target.value) || 0 })} />
                  <select className="input col-span-2" value={pos.unit} onChange={(e) => updatePosition(idx, { unit: e.target.value })}>
                    <option value="St.">St.</option>
                    <option value="Std.">Std.</option>
                    <option value="Pauschal">Pauschal</option>
                  </select>
                  <MoneyInput valueCents={pos.unit_price_cents} onChange={(cents) => updatePosition(idx, { unit_price_cents: cents })} placeholder="Einzelpreis" className="input col-span-2" />
                  <span className="input col-span-1 text-right text-ink-500 tabular-nums">{formatMoney(pos.total_cents)}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
              <Field label="USt. %"><input type="number" className="input" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} /></Field>
              <div className="text-right"><p className="text-2xs text-ink-500">Zwischensumme</p><p className="text-sm font-medium">{formatMoney(subtotal)}</p></div>
              <div className="text-right"><p className="text-2xs text-ink-500">USt.</p><p className="text-sm font-medium">{formatMoney(taxAmount)}</p></div>
            </div>
            <div className="text-right text-lg font-semibold text-ink-900">Gesamt: {formatMoney(total)}</div>

            <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
              <Field label="Rechnungsdatum"><input type="date" className="input" value={issued} onChange={(e) => setIssued(e.target.value)} /></Field>
              <Field label="Fällig bis"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="avv-offer" checked={avv} onChange={(e) => setAvv(e.target.checked)} className="w-4 h-4 rounded border-line accent-accent-600" />
              <label htmlFor="avv-offer" className="text-sm text-ink-700">AVV wurde akzeptiert</label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AVV Components
// ---------------------------------------------------------------------------

function AvvRow({ avv, onMarkSent, onMarkSigned, onRemove, onEdit }: {
  avv: Avv;
  onMarkSent: () => void;
  onMarkSigned: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 py-3 group">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
          avv.status === 'signed' ? 'bg-success-50 text-success-600' :
          avv.status === 'sent' ? 'bg-info-50 text-info-600' :
          avv.status === 'cancelled' ? 'bg-surfaceMuted text-ink-400' :
          'bg-surfaceMuted text-ink-500'
        }`}>
          <FileText size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{avv.title}</p>
          <p className="text-2xs text-ink-500">
            {avv.client_name}
            {avv.valid_until && ` · Gültig bis ${formatDate(avv.valid_until)}`}
            {avv.signed_date && ` · Unterzeichnet ${formatDate(avv.signed_date)}`}
          </p>
        </div>
        <Badge tone={AVV_STATUS_TONE[avv.status]}>{AVV_STATUS_LABELS[avv.status]}</Badge>
        <div className="flex items-center gap-1">
          <button onClick={() => generateAvvPdf(avv, 'download')} className="btn-ghost text-2xs px-2 py-1" title="PDF herunterladen">
            <Download size={13} />
          </button>
          <button onClick={() => generateAvvPdf(avv, 'archive')} className="btn-ghost text-2xs px-2 py-1 text-ink-500 hover:text-accent-600" title="Ins Archiv kopieren">
            <ArchiveRestore size={13} />
          </button>
          {avv.status === 'draft' && (
            <button onClick={onMarkSent} className="btn-ghost text-2xs px-2 py-1" title="Als versendet markieren">
              <Send size={13} />
            </button>
          )}
          {avv.status === 'sent' && (
            <button onClick={onMarkSigned} className="btn-ghost text-2xs px-2 py-1" title="Als unterzeichnet markieren">
              <CheckCircle size={13} />
            </button>
          )}
          {avv.status !== 'signed' && (
            <button onClick={() => setEditing(true)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100" title="Bearbeiten">
              <Pencil size={14} />
            </button>
          )}
          {avv.status !== 'signed' && (
            <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
              <XCircle size={14} />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <EditAvvModal avv={avv} onClose={() => setEditing(false)} onSaved={() => { onEdit(); setEditing(false); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AVV PDF (redesigned — Fundament Studio branding)
// ---------------------------------------------------------------------------

async function generateAvvPdf(avv: Avv, action: 'download' | 'archive' = 'download') {
  const ownerRow = await settings.get('owner_data');
  let owner = { name: 'Dein Name', company: '', address: 'Deine Adresse', email: '' };
  if (ownerRow) {
    try {
      const data = JSON.parse(ownerRow.value);
      owner = { ...owner, ...data };
    } catch { /* ignore */ }
  }

  const { petrol, gold, bordeaux, ink, muted } = PDF_COLORS;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;

  // --- Header band ---
  doc.setFillColor(...petrol);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 34, pageWidth, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('AUFTRAGSVERARBEITUNGSVERTRAG', margin, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(225, 216, 208);
  doc.text('nach Art. 28 DSGVO', margin, 24);
  doc.setFontSize(8);
  doc.text(`AVV-Nr. ${avv.id.slice(0, 8).toUpperCase()}`, pageWidth - margin, 17, { align: 'right' });

  doc.setTextColor(...ink);
  let y = 46;

  const sectionTitle = (title: string) => {
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...bordeaux);
    doc.text(title.toUpperCase(), margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ink);
    doc.setFontSize(9);
    y += 6;
  };

  const party = (label: string, name: string, extras: (string | null | undefined)[]) => {
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    y += 5;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ink);
    doc.text(name, margin, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(70, 70, 70);
    extras.filter((l): l is string => !!l).forEach(block => {
      block.split('\n').forEach(l => { doc.text(l, margin, y); y += 4.6; });
    });
    doc.setTextColor(...ink);
    y += 2;
  };

  party('AUFTRAGNEHMERIN', owner.name || 'Inhaber Name', [owner.company, owner.address, owner.email]);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...gold);
  doc.text('und', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);
  y += 6;

  party('AUFTRAGGEBERIN', avv.client_name, [avv.client_company, avv.client_address, avv.client_email]);

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 9;

  const paragraph = (label: string, text: string | null | undefined) => {
    if (!text) return;
    if (y > pageHeight - 30) { doc.addPage(); y = 20; }
    sectionTitle(label);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, margin, y);
    doc.setTextColor(...ink);
    y += lines.length * 4.8 + 7;
  };

  paragraph('Gegenstand des Auftrags', avv.title + (avv.description ? ` – ${avv.description}` : ''));
  paragraph('Art der Datenverarbeitung', avv.data_categories);
  paragraph('Zweck der Datenverarbeitung', avv.data_purpose);
  paragraph('Speicherdauer / Löschfristen', avv.data_retention);
  paragraph('Technische und organisatorische Maßnahmen', avv.security_measures);

  if (y > pageHeight - 95) { doc.addPage(); y = 20; }

  sectionTitle('Standardvereinbarungen');
  doc.setFillColor(...PDF_COLORS.paleGold);
  const clauses = [
    'Die Auftragnehmerin verarbeitet personenbezogene Daten nur im Auftrag und nach Weisung der Auftraggeberin.',
    'Die Auftragnehmerin gewährleistet die Vertraulichkeit und Integrität der Daten.',
    'Die Auftragnehmerin trifft geeignete technische und organisatorische Maßnahmen zum Schutz der Daten.',
    'Die Auftragnehmerin unterrichtet die Auftraggeberin unverzüglich über Verletzungen des Schutzes personenbezogener Daten.',
    'Nach Abschluss der Verarbeitung werden alle Daten gelöscht oder zurückgegeben.',
  ];
  const clauseBoxY = y - 4;
  doc.setFontSize(8.3);
  let clauseY = y + 1.5;
  clauses.forEach((c, i) => {
    const lines = doc.splitTextToSize(`${i + 1}.  ${c}`, contentWidth - 6);
    clauseY += lines.length * 4.1 + 2.2;
  });
  doc.roundedRect(margin - 3, clauseBoxY, contentWidth + 6, clauseY - clauseBoxY, 1.5, 1.5, 'F');
  doc.setTextColor(70, 70, 70);
  clauses.forEach(c => {
    const lines = doc.splitTextToSize(`•  ${c}`, contentWidth - 6);
    doc.text(lines, margin, y + 2);
    y += lines.length * 4.1 + 2.2;
  });
  doc.setTextColor(...ink);
  y += 6;

  if (avv.valid_until) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...bordeaux);
    doc.text(`Gültig bis zum ${formatDate(avv.valid_until)}`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ink);
    y += 10;
  }

  // --- Signature block ---
  if (y > pageHeight - 50) { doc.addPage(); y = 30; } else { y = Math.max(y + 14, pageHeight - 46); }

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.3);
  doc.line(margin, y - 10, pageWidth - margin, y - 10);

  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text('Ort, Datum:  ___________________________', margin, y);
  y += 16;

  doc.setDrawColor(190, 190, 190);
  doc.setLineWidth(0.2);
  doc.line(margin, y, margin + 72, y);
  doc.line(pageWidth / 2 + 8, y, pageWidth / 2 + 8 + 72, y);
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text('Unterschrift Auftragnehmerin', margin, y);
  doc.text('Unterschrift Auftraggeberin', pageWidth / 2 + 8, y);

  doc.setFontSize(7);
  doc.text(`Erstellt am ${formatDate(avv.created_at)}`, margin, pageHeight - 10);
  doc.text('Fundament Studio', pageWidth - margin, pageHeight - 10, { align: 'right' });

  if (action === 'download') {
    doc.save(`AVV-${avv.client_name.replace(/\s+/g, '-')}.pdf`);
  } else {
    // Ins Archiv kopieren
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.split('base64,')[1];
    
    const docId = await uuid();
    await documents.insert({
      id: docId,
      entity_type: 'client',
      entity_id: avv.client_id || null,
      entity_name: avv.client_name,
      document_type: 'avv',
      title: `AVV: ${avv.title}`,
      status: 'archived',
      file_name: `AVV-${avv.client_name.replace(/\s+/g, '-')}.pdf`,
      file_data: base64,
      file_mime: 'application/pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);
    alert('AVV wurde erfolgreich ins Dokumentenarchiv übertragen.');
  }
}

function AddAvvModal({ open, onClose, clients, onCreated }: {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  onCreated: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dataCategories, setDataCategories] = useState('');
  const [dataPurpose, setDataPurpose] = useState('');
  const [dataRetention, setDataRetention] = useState('');
  const [securityMeasures, setSecurityMeasures] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  function fillFromClient(cid: string) {
    const c = clients.find(x => x.id === cid);
    if (c) {
      setClientName(c.name);
      setClientCompany(c.company || '');
      setClientAddress(c.address || '');
      setClientEmail(c.email || '');
    }
  }

  async function submit() {
    if (!clientName.trim() || !title.trim() || !dataCategories.trim() || !dataPurpose.trim()) return;

    const id = await uuid();
    await avvs.insert({
      id,
      client_id: clientId || null,
      client_name: clientName.trim(),
      client_company: clientCompany.trim() || null,
      client_address: clientAddress.trim() || null,
      client_email: clientEmail.trim() || null,
      title: title.trim(),
      description: description.trim() || null,
      data_categories: dataCategories.trim(),
      data_purpose: dataPurpose.trim(),
      data_retention: dataRetention.trim() || null,
      security_measures: securityMeasures.trim() || null,
      status: 'draft',
      sent_date: null,
      signed_date: null,
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Avv);

    setClientId(''); setClientName(''); setClientCompany(''); setClientAddress(''); setClientEmail('');
    setTitle(''); setDescription(''); setDataCategories(''); setDataPurpose('');
    setDataRetention(''); setSecurityMeasures(''); setValidUntil(''); setNotes('');
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Neuer AVV" size="lg"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary" disabled={!clientName.trim() || !title.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Kunde auswählen (optional)">
          <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); fillFromClient(e.target.value); }}>
            <option value="">— Kunde manuell eingeben —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name des Kunden"><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} /></Field>
          <Field label="Firma"><input className="input" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><textarea className="input min-h-[50px]" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} /></Field>
        <Field label="E-Mail"><input type="email" className="input" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></Field>

        <div className="border-t border-line pt-4">
          <Field label="Titel / Gegenstand"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Website-Entwicklung" /></Field>
          <Field label="Beschreibung (optional)"><textarea className="input min-h-[50px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink-700 mb-3">Datenverarbeitung</h3>
          <Field label="Art der personenbezogenen Daten">
            <textarea className="input min-h-[60px]" value={dataCategories} onChange={(e) => setDataCategories(e.target.value)} placeholder="z.B. Name, E-Mail-Adresse, Telefonnummer" />
          </Field>
          <Field label="Zweck der Verarbeitung">
            <textarea className="input min-h-[60px]" value={dataPurpose} onChange={(e) => setDataPurpose(e.target.value)} placeholder="z.B. Kommunikation zur Projektabwicklung" />
          </Field>
          <Field label="Speicherdauer / Löschfristen (optional)">
            <textarea className="input" value={dataRetention} onChange={(e) => setDataRetention(e.target.value)} placeholder="z.B. Löschung 6 Monate nach Projektabschluss" />
          </Field>
          <Field label="Technische/organisatorische Maßnahmen (optional)">
            <textarea className="input min-h-[60px]" value={securityMeasures} onChange={(e) => setSecurityMeasures(e.target.value)} placeholder="z.B. Verschlüsselung, Zugriffskontrolle, regelmäßige Backups" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Gültig bis (optional)"><input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>

        <Field label="Interne Notizen (optional)">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function EditAvvModal({ avv, onClose, onSaved }: { avv: Avv; onClose: () => void; onSaved: () => void }) {
  const [clientName, setClientName] = useState(avv.client_name);
  const [clientCompany, setClientCompany] = useState(avv.client_company || '');
  const [clientAddress, setClientAddress] = useState(avv.client_address || '');
  const [clientEmail, setClientEmail] = useState(avv.client_email || '');
  const [title, setTitle] = useState(avv.title);
  const [description, setDescription] = useState(avv.description || '');
  const [dataCategories, setDataCategories] = useState(avv.data_categories);
  const [dataPurpose, setDataPurpose] = useState(avv.data_purpose);
  const [dataRetention, setDataRetention] = useState(avv.data_retention || '');
  const [securityMeasures, setSecurityMeasures] = useState(avv.security_measures || '');
  const [validUntil, setValidUntil] = useState(avv.valid_until || '');
  const [notes, setNotes] = useState(avv.notes || '');

  function save() {
    avvs.update(avv.id, {
      client_name: clientName.trim(),
      client_company: clientCompany.trim() || null,
      client_address: clientAddress.trim() || null,
      client_email: clientEmail.trim() || null,
      title: title.trim(),
      description: description.trim() || null,
      data_categories: dataCategories.trim(),
      data_purpose: dataPurpose.trim(),
      data_retention: dataRetention.trim() || null,
      security_measures: securityMeasures.trim() || null,
      valid_until: validUntil || null,
      notes: notes.trim() || null,
    });
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="AVV bearbeiten" size="lg"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={save} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name des Kunden"><input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} /></Field>
          <Field label="Firma"><input className="input" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} /></Field>
        </div>
        <Field label="Adresse"><textarea className="input min-h-[50px]" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} /></Field>
        <Field label="E-Mail"><input type="email" className="input" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></Field>

        <div className="border-t border-line pt-4">
          <Field label="Titel / Gegenstand"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Beschreibung"><textarea className="input min-h-[50px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink-700 mb-3">Datenverarbeitung</h3>
          <Field label="Art der personenbezogenen Daten">
            <textarea className="input min-h-[60px]" value={dataCategories} onChange={(e) => setDataCategories(e.target.value)} />
          </Field>
          <Field label="Zweck der Verarbeitung">
            <textarea className="input min-h-[60px]" value={dataPurpose} onChange={(e) => setDataPurpose(e.target.value)} />
          </Field>
          <Field label="Speicherdauer / Löschfristen">
            <textarea className="input" value={dataRetention} onChange={(e) => setDataRetention(e.target.value)} />
          </Field>
          <Field label="Technische/organisatorische Maßnahmen">
            <textarea className="input min-h-[60px]" value={securityMeasures} onChange={(e) => setSecurityMeasures(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Gültig bis"><input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>

        <Field label="Interne Notizen"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Invoice PDF (redesigned — Fundament Studio branding)
// ---------------------------------------------------------------------------

async function generatePdf(inv: Invoice, action: 'download' | 'archive' = 'download') {
  const ownerRow = await settings.get('owner_data');
  let owner = { name: 'Dein Name', company: '', address: 'Deine Adresse', email: '', iban: '', bankName: '' };
  if (ownerRow) {
    try {
      const data = JSON.parse(ownerRow.value);
      owner = { ...owner, ...data };
    } catch { /* ignore */ }
  }

  const { petrol, gold, bordeaux, ink, muted, paleGold } = PDF_COLORS;
  const doc = new jsPDF() as jsPDF & { lastAutoTable: { finalY: number } };
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;

  // --- Header band ---
  doc.setFillColor(...petrol);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 38, pageWidth, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('RECHNUNG', margin, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(225, 216, 208);
  doc.text(`Nr. ${inv.invoice_number}`, margin, 30);

  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(owner.company || owner.name || '', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  doc.setTextColor(...ink);

  // --- Cancelled watermark ---
  if (inv.status === 'cancelled') {
    doc.setTextColor(220, 90, 90);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(70);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const GState = (doc as any).GState;
    if (GState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc as any).setGState(new GState({ opacity: 0.13 }));
    }
    doc.text('STORNIERT', pageWidth / 2, pageHeight / 2, { align: 'center', angle: 35 });
    if (GState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doc as any).setGState(new GState({ opacity: 1 }));
    }
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
  }

  // --- Sender / Recipient ---
  let y = 52;
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text('VON', margin, y);
  doc.text('AN', pageWidth / 2 + 6, y);
  y += 5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text(owner.name || 'Dein Name', margin, y);
  doc.text(inv.client_name, pageWidth / 2 + 6, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);

  let leftY = y + 5;
  let rightY = y + 5;
  if (owner.company) { doc.text(owner.company, margin, leftY); leftY += 4.6; }
  owner.address?.split('\n').forEach((line: string) => { doc.text(line, margin, leftY); leftY += 4.6; });
  if (owner.email) { doc.text(owner.email, margin, leftY); leftY += 4.6; }

  if (inv.client_company) { doc.text(inv.client_company, pageWidth / 2 + 6, rightY); rightY += 4.6; }
  if (inv.client_address) {
    inv.client_address.split('\n').forEach(line => { doc.text(line, pageWidth / 2 + 6, rightY); rightY += 4.6; });
  }
  if (inv.client_email) { doc.text(inv.client_email, pageWidth / 2 + 6, rightY); rightY += 4.6; }

  doc.setTextColor(...ink);
  y = Math.max(leftY, rightY) + 6;

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // --- Meta row ---
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text('RECHNUNGSDATUM', margin, y);
  doc.text('FÄLLIG BIS', margin + 55, y);
  if (inv.avv_accepted) doc.text('AVV', margin + 110, y);
  y += 5;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text(formatDate(inv.issued_date), margin, y);
  doc.text(inv.due_date ? formatDate(inv.due_date) : '—', margin + 55, y);
  if (inv.avv_accepted) {
    doc.setTextColor(...bordeaux);
    doc.text('Akzeptiert' + (inv.avv_accepted_at ? ` (${formatDate(inv.avv_accepted_at)})` : ''), margin + 110, y);
    doc.setTextColor(...ink);
  }
  doc.setFont('helvetica', 'normal');
  y += 11;

  if (inv.status === 'cancelled') {
    doc.setFillColor(252, 235, 235);
    doc.roundedRect(margin, y - 5, pageWidth - margin * 2, inv.cancel_reason ? 14 : 9, 1.5, 1.5, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(190, 60, 60);
    doc.text(
      `Storniert${inv.cancelled_at ? ` am ${formatDate(inv.cancelled_at)}` : ''}`,
      margin + 3,
      y
    );
    doc.setFont('helvetica', 'normal');
    if (inv.cancel_reason) {
      doc.setFontSize(8);
      doc.setTextColor(150, 70, 70);
      doc.text(`Grund: ${inv.cancel_reason}`, margin + 3, y + 5.5);
    }
    doc.setTextColor(...ink);
    y += inv.cancel_reason ? 16 : 11;
  }

  const positions: InvoicePosition[] = JSON.parse(inv.positions_json || '[]');

  if (positions.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Beschreibung', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamt']],
      body: positions.map(p => [
        p.description,
        String(p.quantity),
        p.unit,
        formatMoney(p.unit_price_cents),
        formatMoney(p.total_cents),
      ]),
      theme: 'plain',
      margin: { left: margin, right: margin },
      headStyles: {
        fillColor: petrol,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
      },
      bodyStyles: {
        fontSize: 9,
        textColor: ink,
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        lineColor: [230, 226, 222],
        lineWidth: 0.1,
      },
      alternateRowStyles: { fillColor: paleGold },
      columnStyles: {
        0: { cellWidth: 78 },
        1: { cellWidth: 20, halign: 'right' },
        2: { cellWidth: 22, halign: 'center' },
        3: { cellWidth: 30, halign: 'right' },
        4: { cellWidth: 30, halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  } else {
    y += 5;
  }

  // --- Totals ---
  const totalsX = pageWidth - margin - 70;
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text('Zwischensumme', totalsX, y);
  doc.setTextColor(...ink);
  doc.text(formatMoney(inv.subtotal_cents), pageWidth - margin, y, { align: 'right' });
  y += 6;
  doc.setTextColor(...muted);
  doc.text(`USt. (${inv.tax_rate_pct}%)`, totalsX, y);
  doc.setTextColor(...ink);
  doc.text(formatMoney(inv.tax_amount_cents), pageWidth - margin, y, { align: 'right' });
  y += 4;

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.3);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 8;

  doc.setFillColor(...petrol);
  doc.roundedRect(totalsX - 4, y - 6.5, (pageWidth - margin) - (totalsX - 4), 11, 1.5, 1.5, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Gesamtbetrag', totalsX, y + 1);
  doc.text(formatMoney(inv.total_cents), pageWidth - margin, y + 1, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);

  y += 22;
  if (y > pageHeight - 45) { doc.addPage(); y = 25; }

  // --- Payment info ---
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...bordeaux);
  doc.text('ZAHLUNGSINFORMATIONEN', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);
  y += 6;
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text('Bitte überweise den Betrag innerhalb des Zahlungsziels auf folgendes Konto:', margin, y);
  y += 5;
  if (owner.iban) {
    doc.text(`IBAN: ${owner.iban}`, margin, y);
    if (owner.bankName) { y += 4.8; doc.text(`Bank: ${owner.bankName}`, margin, y); }
  } else {
    doc.text('IBAN: —', margin, y);
  }
  y += 4.8;
  doc.text(`Verwendungszweck: ${inv.invoice_number}`, margin, y);
  doc.setTextColor(...ink);

  // --- Footer ---
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 22, pageWidth - margin, pageHeight - 22);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...muted);
  doc.text('Vielen Dank für deinen Auftrag!', pageWidth / 2, pageHeight - 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');

  if (action === 'download') {
    doc.save(`Rechnung-${inv.invoice_number}.pdf`);
  } else {
    // Ins Archiv kopieren
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.split('base64,')[1];
    
    const docId = await uuid();
    await documents.insert({
      id: docId,
      entity_type: inv.project_id ? 'project' : 'general',
      entity_id: inv.project_id || null,
      entity_name: inv.client_name,
      document_type: 'other',
      title: `Rechnung ${inv.invoice_number}`,
      status: 'archived',
      file_name: `Rechnung-${inv.invoice_number}.pdf`,
      file_data: base64,
      file_mime: 'application/pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);
    alert('Rechnung wurde erfolgreich ins Dokumentenarchiv übertragen.');
  }
}

// ---------------------------------------------------------------------------
// EüR Export (German-locale CSV, cleaner numeric formatting)
// ---------------------------------------------------------------------------

function exportEueR(list: Invoice[]) {
  const paid = list.filter(i => i.status === 'paid' && i.paid_date);
  if (paid.length === 0) {
    alert('Keine bezahlten Rechnungen für den Export vorhanden.');
    return;
  }
  const deNumber = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

  const rows = paid
    .sort((a, b) => (a.paid_date || '').localeCompare(b.paid_date || ''))
    .map(i => [
      i.invoice_number,
      formatDate(i.issued_date),
      i.paid_date ? formatDate(i.paid_date) : '',
      i.client_name,
      deNumber(i.subtotal_cents),
      `${i.tax_rate_pct.toString().replace('.', ',')} %`,
      deNumber(i.tax_amount_cents),
      deNumber(i.total_cents),
      i.currency,
    ]);

  const totalNetto = paid.reduce((s, i) => s + i.subtotal_cents, 0);
  const totalUst = paid.reduce((s, i) => s + i.tax_amount_cents, 0);
  const totalBrutto = paid.reduce((s, i) => s + i.total_cents, 0);

  const header = ['Rechnungsnummer', 'Rechnungsdatum', 'Zahlungsdatum', 'Kunde', 'Netto (EUR)', 'USt %', 'USt (EUR)', 'Brutto (EUR)', 'Währung'];
  const summaryRow = ['', '', '', 'Summe', deNumber(totalNetto), '', deNumber(totalUst), deNumber(totalBrutto), 'EUR'];

  const csvContent = [header, ...rows, summaryRow]
    .map(r => r.map(c => `"${c}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EueR-Export-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}