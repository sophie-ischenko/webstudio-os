import { useEffect, useState, useCallback } from 'react';
import { 
  Plus, Trash2, TrendingUp, TrendingDown, Wallet, Target, Pencil, 
  FileText, XCircle, Download, ArchiveRestore, Calendar
} from 'lucide-react';
import { transactions, offers, goals2, projects, invoices, clients, recurring, uuid, settings } from '../lib/db';
import type { Transaction, Offer, Goal, Project, Invoice, InvoicePosition, Client } from '../types';
import { formatMoney, formatMoneyShort, formatDate, todayISO, parseMoneyToCents } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader, MoneyInput } from '../components/ui';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DEFAULT_TAX_RATE = 19;

const PDF_COLORS = {
  petrol: [31, 62, 68] as [number, number, number],
  gold: [180, 132, 105] as [number, number, number],
  bordeaux: [115, 56, 67] as [number, number, number],
  ink: [40, 40, 40] as [number, number, number],
  muted: [120, 120, 120] as [number, number, number],
  paleGold: [247, 243, 240] as [number, number, number],
};

const STATUS_LABELS = {
  open: 'Offen', paid: 'Bezahlt', overdue: 'Überfällig', cancelled: 'Storniert',
} as const;

export function FinancesView() {
  const [txList, setTxList] = useState<Transaction[]>([]);
  const [offerList, setOfferList] = useState<Offer[]>([]);
  
  // FIX: Wir laden die Ziele aus goals2 (Zielplaner-Tabelle)
  const [globalGoals, setGlobalGoals] = useState<Goal[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [showAddTx, setShowAddTx] = useState(false);
  const [showAddOffer, setShowAddOffer] = useState(false);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [recurringList, setRecurringList] = useState<any[]>([]);

  // Angebot das direkt in eine Rechung umgewandelt werden soll
  const [offerToInvoice, setOfferToInvoice] = useState<Offer | null>(null);

  const load = useCallback(async () => {
    setTxList(await transactions.list());
    setOfferList(await offers.list());
    setGlobalGoals(await goals2.list()); // Lädt alle Ziele aus der 'goals' Tabelle
    setProjectList(await projects.list());
    setClientList(await clients.list());
    setRecurringList(await recurring.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTx = txList.filter(t => new Date(t.transaction_date) >= monthStart);
  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount_cents, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount_cents, 0);
  const balance = income - expense;

  const openOffers = offerList.filter(o => o.status === 'sent' || o.status === 'negotiating' || o.status === 'draft');
  const pipelineTotal = openOffers.reduce((s, o) => s + (o.estimated_value_cents || 0), 0);
  const pipelineWeighted = openOffers.reduce((s, o) => s + (o.estimated_value_cents || 0) * (o.probability_pct || 0) / 100, 0);

  const currentYear = now.getFullYear();
  const currentYearStr = String(currentYear);

  // FIX: Wir filtern die Jahres-Ziele aus der globalen Tabelle heraus
  const annualRevenueGoal = globalGoals.find(g => g.period_type === 'year' && g.period_key === currentYearStr && g.category === 'revenue');
  const annualProjectGoal = globalGoals.find(g => g.period_type === 'year' && g.period_key === currentYearStr && g.category === 'projects');

  const hasAnnualGoals = annualRevenueGoal || annualProjectGoal;

  const yearIncome = txList
    .filter(t => t.type === 'income' && new Date(t.transaction_date).getFullYear() === currentYear)
    .reduce((s, t) => s + t.amount_cents, 0);

  const yearProjectCount = projectList.filter(p =>
    p.status === 'done' && p.actual_end_date && new Date(p.actual_end_date).getFullYear() === currentYear
  ).length;

  const activeRecurring = recurringList
    .filter(r => r.active === 1)
    .sort((a, b) => a.next_date.localeCompare(b.next_date));

  async function handleOfferStatusChange(offer: Offer, newStatus: Offer['status']) {
    await offers.update(offer.id, { status: newStatus });
    if (newStatus === 'won') {
      setOfferToInvoice({ ...offer, status: 'won' });
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink-900">Finanzen</h1>
        <p className="text-sm text-ink-500 mt-0.5">Cashflow, Pipeline, Fixkosten und Jahresziele</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cashflow */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-accent-600" />
              <h2 className="section-title">Cashflow</h2>
            </div>
            <Badge tone="neutral">lfd. Monat</Badge>
          </div>
          <div className="space-y-3 mb-4">
            <Row label="Einnahmen" value={income} tone="success" icon={<TrendingUp size={14} />} />
            <Row label="Ausgaben" value={expense} tone="danger" icon={<TrendingDown size={14} />} />
            <div className="h-px bg-line" />
            <Row label="Saldo" value={balance} tone={balance >= 0 ? 'accent' : 'danger'} bold />
          </div>
          <button onClick={() => setShowAddTx(true)} className="btn-outline w-full text-sm">
            <Plus size={14} /> Buchung erfassen
          </button>
        </div>

        {/* Pipeline */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-info-600" />
              <h2 className="section-title">Pipeline</h2>
            </div>
            <Badge tone="info">{openOffers.length} offen</Badge>
          </div>
          <div className="space-y-2 mb-4">
            <Row label="Volumen gesamt" value={pipelineTotal} tone="info" />
            <Row label="Gewichtet (× Wahrsch.)" value={Math.round(pipelineWeighted)} tone="accent" bold />
          </div>
          <button onClick={() => setShowAddOffer(true)} className="btn-outline w-full text-sm">
            <Plus size={14} /> Angebot erfassen
          </button>
        </div>

        {/* Jahresziel (Synchronisiert mit dem globalen Zielplaner) */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Target size={18} className="text-success-600" />
              <h2 className="section-title">Jahresziel {currentYear}</h2>
            </div>
            {hasAnnualGoals ? <Badge tone="success">aktiv</Badge> : <Badge tone="warning">fehlt</Badge>}
          </div>
          {hasAnnualGoals ? (
            <div className="space-y-3">
              {annualRevenueGoal && annualRevenueGoal.target_value && (
                <GoalProgress 
                  label="Umsatz" 
                  current={yearIncome} 
                  target={annualRevenueGoal.target_value * 100} // Konvertierung von Euro in Cents
                  formatFn={formatMoneyShort} 
                />
              )}
              {annualProjectGoal && annualProjectGoal.target_value && (
                <GoalProgress 
                  label="Projekte" 
                  current={yearProjectCount} 
                  target={annualProjectGoal.target_value} 
                  formatFn={(n) => String(n)} 
                />
              )}
            </div>
          ) : (
            <EmptyState title="Kein Jahresziel" hint="Lege ein Ziel für dieses Jahr fest." />
          )}
          {/* Neuer GoalEditor, der direkt in die globale 'goals' Tabelle schreibt */}
          <GoalEditor 
            year={currentYear} 
            revenueGoal={annualRevenueGoal || null} 
            projectGoal={annualProjectGoal || null} 
            onSaved={load} 
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Letzte Buchungen */}
        <div className="card p-5">
          <SectionHeader title="Letzte Buchungen" action={
            <button onClick={() => setShowAddTx(true)} className="btn-ghost text-sm"><Plus size={14} /> Neu</button>
          } />
          {txList.length === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="Keine Buchungen" hint="Erfasse Einnahmen oder Ausgaben." />
          ) : (
            <div className="divide-y divide-line">
              {txList.slice(0, 10).map(t => (
                <div key={t.id} className="flex items-center gap-3 py-2.5 group">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.type === 'income' ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'}`}>
                    {t.type === 'income' ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{t.description}</p>
                    <p className="text-2xs text-ink-500">{formatDate(t.transaction_date)}{t.category ? ` · ${t.category}` : ''}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${t.type === 'income' ? 'text-success-700' : 'text-danger-600'}`}>
                    {t.type === 'income' ? '+' : '−'}{formatMoney(t.amount_cents)}
                  </span>
                  <button onClick={() => transactions.remove(t.id).then(load)} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Wiederkehrende Ausgaben / Tool-Abos */}
        <div className="card p-5">
          <SectionHeader title="Anstehende Tool-Abos & Fixkosten" />
          {activeRecurring.length === 0 ? (
            <EmptyState icon={<Calendar size={24} />} title="Keine Fixkosten" hint="Lege Tool-Abos unter Lieferanten an." />
          ) : (
            <div className="divide-y divide-line">
              {activeRecurring.slice(0, 8).map(r => {
                const isDue = r.next_date <= todayISO();
                return (
                  <div key={r.id} className="flex items-center gap-3 py-2.5 group">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDue ? 'bg-warning-50 text-warning-600' : 'bg-surfaceMuted text-ink-500'}`}>
                      <Calendar size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{r.description}</p>
                      <p className={`text-2xs ${isDue ? 'text-warning-600 font-medium' : 'text-ink-500'}`}>
                        {r.category || 'Abo'} · {isDue ? 'Fällig seit' : 'Nächste'}: {formatDate(r.next_date)}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums text-ink-900">
                      {formatMoney(r.amount_cents)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => recurring.confirmOne(r).then(load)}
                        className={`text-2xs px-2 py-1 ${isDue ? 'btn-primary' : 'btn-outline text-ink-500 hover:text-ink-900'}`}
                        title="Jetzt als Ausgabe buchen"
                      >
                        Buchen
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`"${r.description}" wirklich löschen?`)) {
                            recurring.remove(r.id).then(load);
                          }
                        }}
                        className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100"
                        title="Tool/Fixkosten löschen"
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
      </div>

      {/* Angebote */}
      <div className="card p-5">
        <SectionHeader title="Angebote" action={
          <button onClick={() => setShowAddOffer(true)} className="btn-ghost text-sm"><Plus size={14} /> Neu</button>
        } />
        {offerList.length === 0 ? (
          <EmptyState icon={<Target size={24} />} title="Keine Angebote" hint="Erfasse Angebote für deine Pipeline." />
        ) : (
          <div className="space-y-2">
            {offerList.map(o => (
              <OfferRow
                key={o.id}
                offer={o}
                onRemove={() => offers.remove(o.id).then(load)}
                onStatusChange={(status) => handleOfferStatusChange(o, status)}
                onUpdate={(fields) => offers.update(o.id, fields).then(load)}
                onCreateInvoice={() => setOfferToInvoice(o)}
              />
            ))}
          </div>
        )}
      </div>

      <AddTxModal open={showAddTx} onClose={() => setShowAddTx(false)} projects={projectList} onAdded={load} />
      <AddOfferModal open={showAddOffer} onClose={() => setShowAddOffer(false)} onAdded={load} />

      {offerToInvoice && (
        <OfferToInvoiceModal
          offer={offerToInvoice}
          projects={projectList}
          clients={clientList}
          onClose={() => setOfferToInvoice(null)}
          onCreated={() => { setOfferToInvoice(null); load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row Helpers
// ---------------------------------------------------------------------------

function Row({ label, value, tone, bold, icon }: {
  label: string; value: number;
  tone: 'success' | 'danger' | 'accent' | 'info';
  bold?: boolean; icon?: React.ReactNode;
}) {
  const color = tone === 'success' ? 'text-success-700' : tone === 'danger' ? 'text-danger-600' : tone === 'info' ? 'text-info-600' : 'text-accent-700';
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm flex items-center gap-1.5 ${bold ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
        {icon}{label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${color}`}>{formatMoney(value)}</span>
    </div>
  );
}

function GoalProgress({ label, current, target, formatFn }: {
  label: string; current: number; target: number; formatFn: (n: number) => string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-ink-700">{label}</span>
        <span className="text-2xs text-ink-500 tabular-nums">{formatFn(current)} / {formatFn(target)}</span>
      </div>
      <div className="h-2 rounded-full bg-surfaceMuted overflow-hidden">
        <div className="h-full bg-success-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offer Row
// ---------------------------------------------------------------------------

function OfferRow({ offer, onRemove, onStatusChange, onUpdate, onCreateInvoice }: {
  offer: Offer;
  onRemove: () => void;
  onStatusChange: (status: Offer['status']) => void;
  onUpdate: (fields: Partial<Offer>) => void;
  onCreateInvoice: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const statusTone: Record<Offer['status'], string> = {
    draft: 'bg-surfaceMuted text-ink-600',
    sent: 'bg-info-100 text-info-700',
    negotiating: 'bg-warning-100 text-warning-700',
    won: 'bg-success-100 text-success-700',
    lost: 'bg-danger-100 text-danger-700',
  };
  const labels: Record<Offer['status'], string> = {
    draft: 'Entwurf', sent: 'Versendet', negotiating: 'Verhandlung', won: 'Gewonnen', lost: 'Verloren',
  };

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surfaceAlt group">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{offer.title}</p>
          <p className="text-2xs text-ink-500">
            {offer.client_name}
            {offer.decision_expected_date ? ` · Entscheidung bis ${formatDate(offer.decision_expected_date)}` : ''}
          </p>
        </div>

        {offer.probability_pct != null && (
          <span className="text-2xs text-ink-400 tabular-nums">{offer.probability_pct}%</span>
        )}

        <select
          value={offer.status}
          onChange={(e) => onStatusChange(e.target.value as Offer['status'])}
          className={`
            text-2xs font-medium
            rounded-full
            px-2.5 py-1
            border border-line
            cursor-pointer
            focus:outline-none
            bg-surface
            text-ink-900
            dark:bg-surfaceAlt
            dark:text-ink-100
            dark:border-line
            ${statusTone[offer.status]}
          `}        
        >
          {(Object.keys(labels) as Offer['status'][]).map(key => (
            <option
              key={key}
              value={key}
              className="bg-surface text-ink-900 dark:bg-surface dark:text-ink-100"
            >
              {labels[key]}
            </option>          
          ))}
        </select>

        {offer.estimated_value_cents != null && (
          <span className="text-sm font-medium text-ink-900 tabular-nums">{formatMoney(offer.estimated_value_cents)}</span>
        )}

        <div className="flex items-center gap-1">
          <button onClick={() => generateOfferPdf(offer, 'download')} className="p-1 text-ink-400 hover:text-ink-600 opacity-0 group-hover:opacity-100" title="Angebot als PDF laden">
            <Download size={14} />
          </button>
          
          <button onClick={() => generateOfferPdf(offer, 'archive')} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100" title="Ins Dokumentenarchiv übertragen">
            <ArchiveRestore size={14} />
          </button>

          {offer.status === 'won' && (
            <button
              onClick={onCreateInvoice}
              className="btn-ghost text-2xs px-2 py-1 text-success-600"
              title="Rechnung aus diesem Angebot erstellen"
            >
              <FileText size={12} /> Rechnung
            </button>
          )}

          <button onClick={() => setEditing(true)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100">
            <Pencil size={14} />
          </button>
          
          <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <EditOfferModal
          offer={offer}
          onClose={() => setEditing(false)}
          onSaved={(fields) => { onUpdate(fields); setEditing(false); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Offer → Invoice Modal
// ---------------------------------------------------------------------------

function OfferToInvoiceModal({ offer, projects, clients, onClose, onCreated }: {
  offer: Offer;
  projects: Project[];
  clients: Client[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState(offer.client_name);
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [positions, setPositions] = useState<InvoicePosition[]>([{
    description: offer.title,
    quantity: 1,
    unit: 'Pauschal',
    unit_price_cents: offer.estimated_value_cents || 0,
    total_cents: offer.estimated_value_cents || 0,
    tax_rate_pct: DEFAULT_TAX_RATE,
  }]);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE);
  const [issued, setIssued] = useState(todayISO());
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');

  const subtotal = positions.reduce((s, p) => s + p.total_cents, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100);
  const total = subtotal + taxAmount;

  function fillFromClient(cid: string) {
    const c = clients.find(x => x.id === cid);
    if (!c) return;
    setClientId(cid);
    setClientName(c.name);
    setCompany(c.company || '');
    setAddress(c.address || '');
    setEmail(c.email || '');
  }

  function updatePosition(idx: number, fields: Partial<InvoicePosition>) {
    const next = [...positions];
    next[idx] = { ...next[idx], ...fields };
    next[idx].total_cents = Math.round(next[idx].quantity * next[idx].unit_price_cents);
    setPositions(next);
  }

  function addPosition() {
    setPositions([...positions, { description: '', quantity: 1, unit: 'St.', unit_price_cents: 0, total_cents: 0, tax_rate_pct: taxRate }]);
  }

  function removePosition(idx: number) {
    setPositions(positions.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!clientName.trim() || positions.every(p => !p.description.trim())) return;
    const year = new Date().getFullYear();
    const invoiceNumber = await invoices.nextNumber(year);
    const id = await uuid();
    await invoices.insert({
      id,
      project_id: projectId || null,
      offer_id: offer.id,
      invoice_number: invoiceNumber,
      client_name: clientName.trim(),
      client_id: clientId || null,
      client_company: company.trim() || null,
      client_address: address.trim() || null,
      client_email: email.trim() || null,
      positions_json: JSON.stringify(positions.filter(p => p.description.trim())),
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
      avv_accepted: 0,
      avv_accepted_at: null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Invoice);
    onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rechnung aus Angebot: ${offer.title}`}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Abbrechen</button>
          <button onClick={submit} className="btn-primary" disabled={!clientName.trim()}>
            Rechnung erstellen
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="px-3 py-2.5 rounded-lg bg-success-50 border border-success-200 text-sm text-success-700">
          Angebot gewonnen 🎉 — Erstelle jetzt direkt die Rechnungsdatei. Alle Felder sind vorbefüllt und können angepasst werden.
        </div>

        <Field label="Kunde aus CRM auswählen (optional)">
          <select className="input" value={clientId} onChange={(e) => fillFromClient(e.target.value)}>
            <option value="">— Aus Angebot übernommen / manuell —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Kundenname">
            <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </Field>
          <Field label="Firma (optional)">
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
        </div>

        <Field label="Adresse (optional)">
          <textarea className="input min-h-[60px]" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="E-Mail (optional)">
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Projekt (optional)">
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Kein Projekt —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink-700 mb-3">Positionen</h3>
          {positions.map((pos, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <input
                className="input col-span-5"
                placeholder="Beschreibung"
                value={pos.description}
                onChange={(e) => updatePosition(idx, { description: e.target.value })}
              />
              <input
                type="number"
                className="input col-span-1"
                value={pos.quantity}
                onChange={(e) => updatePosition(idx, { quantity: parseFloat(e.target.value) || 0 })}
              />
              <select className="input col-span-2" value={pos.unit} onChange={(e) => updatePosition(idx, { unit: e.target.value })}>
                <option value="Pauschal">Pauschal</option>
                <option value="St.">St.</option>
                <option value="Std.">Std.</option>
                <option value="Tag">Tag</option>
                <option value="Monat">Monat</option>
              </select>
              <MoneyInput
                valueCents={pos.unit_price_cents}
                onChange={(cents) => updatePosition(idx, { unit_price_cents: cents })}
                placeholder="Einzelpreis"
                className="input col-span-2"
              />
              <span className="input col-span-1 text-right tabular-nums text-ink-500">{formatMoney(pos.total_cents)}</span>
              {positions.length > 1 && (
                <button onClick={() => removePosition(idx)} className="btn-ghost text-danger-600 px-2">
                  <XCircle size={14} />
                </button>
              )}
            </div>
          ))}
          <button onClick={addPosition} className="btn-ghost text-sm mt-1">
            <Plus size={14} /> Position hinzufügen
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Field label="USt. %">
            <input type="number" className="input" value={taxRate} onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} />
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

        <div className="text-right text-lg font-semibold text-ink-900">
          Gesamt: {formatMoney(total)}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Field label="Rechnungsdatum">
            <input type="date" className="input" value={issued} onChange={(e) => setIssued(e.target.value)} />
          </Field>
          <Field label="Fällig bis">
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        <Field label="Notizen (optional)">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FIX: Neuer Goal Editor (Nutzt die globale 'goals' Tabelle)
// ---------------------------------------------------------------------------

function GoalEditor({ year, revenueGoal, projectGoal, onSaved }: { 
  year: number; 
  revenueGoal: Goal | null; 
  projectGoal: Goal | null; 
  onSaved: () => void; 
}) {
  const [open, setOpen] = useState(false);
  
  // Eingabefelder befüllen mit bestehenden Werten (ohne Cent-Berechnung im UI)
  const [revenue, setRevenue] = useState(revenueGoal?.target_value ? String(revenueGoal.target_value) : '');
  const [count, setCount] = useState(projectGoal?.target_value ? String(projectGoal.target_value) : '');

  useEffect(() => {
    setRevenue(revenueGoal?.target_value ? String(revenueGoal.target_value) : '');
    setCount(projectGoal?.target_value ? String(projectGoal.target_value) : '');
  }, [revenueGoal, projectGoal, open]);

  async function save() {
    const yearStr = String(year);

    // 1. Umsatz-Jahresziel verarbeiten
    if (revenue.trim()) {
      const targetVal = parseFloat(revenue);
      if (revenueGoal) {
        await goals2.update(revenueGoal.id, { target_value: targetVal });
      } else {
        const id = await uuid();
        await goals2.insert({
          id,
          title: `Jahresziel Umsatz ${year}`,
          period_type: 'year',
          period_key: yearStr,
          target_value: targetVal,
          current_value: 0,
          unit: '€',
          category: 'revenue',
          notes: null,
          is_completed: 0,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as any);
      }
    } else if (revenueGoal) {
      await goals2.remove(revenueGoal.id);
    }

    // 2. Projektanzahl-Jahresziel verarbeiten
    if (count.trim()) {
      const targetVal = parseFloat(count);
      if (projectGoal) {
        await goals2.update(projectGoal.id, { target_value: targetVal });
      } else {
        const id = await uuid();
        await goals2.insert({
          id,
          title: `Jahresziel Projekte ${year}`,
          period_type: 'year',
          period_key: yearStr,
          target_value: targetVal,
          current_value: 0,
          unit: 'Projekte',
          category: 'projects',
          notes: null,
          is_completed: 0,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as any);
      }
    } else if (projectGoal) {
      await goals2.remove(projectGoal.id);
    }

    setOpen(false);
    onSaved();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost w-full mt-4 text-sm">
        {hasGoals(revenueGoal, projectGoal) ? 'Jahresziele anpassen' : 'Jahresziele setzen'}
      </button>
    );
  }

  return (
    <div className="mt-4 p-3 rounded-lg bg-surfaceAlt/50 space-y-2">
      <Field label="Umsatzziel (€)">
        <input type="number" className="input text-sm" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="z.B. 60000" />
      </Field>
      <Field label="Projektanzahl">
        <input type="number" className="input text-sm" value={count} onChange={(e) => setCount(e.target.value)} placeholder="z.B. 12" />
      </Field>
      <div className="flex gap-2 pt-1">
        <button onClick={save} className="btn-primary text-sm">Speichern</button>
        <button onClick={() => setOpen(false)} className="btn-ghost text-sm">Abbrechen</button>
      </div>
    </div>
  );
}

function hasGoals(rev: Goal | null, proj: Goal | null): boolean {
  return rev !== null || proj !== null;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function AddTxModal({ open, onClose, projects: projectList, onAdded }: {
  open: boolean; onClose: () => void; projects: Project[]; onAdded: () => void;
}) {
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(todayISO());
  const [projectId, setProjectId] = useState('');

  async function submit() {
    const cents = parseMoneyToCents(amount);
    if (cents <= 0 || !description.trim()) return;
    const id = await uuid();
    await transactions.insert({
      id, type, amount_cents: cents, currency: 'EUR',
      description: description.trim(), category: category.trim() || null,
      project_id: projectId || null, transaction_date: date,
      reference_type: null, reference_id: null, recurring_id: null,
      tax_rate_pct: null, net_amount_cents: null, tax_amount_cents: null,
      created_at: new Date().toISOString(),
    });
    setAmount(''); setDescription(''); setCategory(''); setProjectId('');
    onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Buchung erfassen" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setType('expense')} className={`btn flex-1 ${type === 'expense' ? 'bg-danger-50 text-danger-700 border border-danger-500/30' : 'bg-surfaceMuted text-ink-500'}`}>
            <TrendingDown size={15} /> Ausgabe
          </button>
          <button onClick={() => setType('income')} className={`btn flex-1 ${type === 'income' ? 'bg-success-50 text-success-700 border border-success-500/30' : 'bg-surfaceMuted text-ink-500'}`}>
            <TrendingUp size={15} /> Einnahme
          </button>
        </div>
        <Field label="Betrag (€)">
          <input type="text" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="z.B. 49,90" autoFocus />
        </Field>
        <Field label="Beschreibung">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="z.B. Hosting-Kosten" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie">
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z.B. Software" />
          </Field>
          <Field label="Datum">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Projekt (optional)">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— Kein Projekt —</option>
            {projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function AddOfferModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [client, setClient] = useState('');
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [probability, setProbability] = useState('50');
  const [status, setStatus] = useState<Offer['status']>('draft');
  const [decisionDate, setDecisionDate] = useState('');

  async function submit() {
    if (!client.trim() || !title.trim()) return;
    const id = await uuid();
    await offers.insert({
      id, client_name: client.trim(), client_id: null, title: title.trim(),
      estimated_value_cents: value ? parseMoneyToCents(value) : null,
      probability_pct: probability ? parseInt(probability) : null,
      status,
      sent_date: null, decision_expected_date: decisionDate || null,
      converted_project_id: null, notes: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    setClient(''); setTitle(''); setValue(''); setProbability('50'); setDecisionDate('');
    onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Angebot erfassen" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <Field label="Kundin"><input className="input" value={client} onChange={(e) => setClient(e.target.value)} autoFocus /></Field>
        <Field label="Titel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Website-Relaunch" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Geschätzter Wert (€)">
            <input type="text" inputMode="decimal" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="z.B. 8000" />
          </Field>
          <Field label="Wahrscheinlichkeit (%)">
            <input type="number" min="0" max="100" className="input" value={probability} onChange={(e) => setProbability(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Offer['status'])}>
              <option value="draft">Entwurf</option>
              <option value="sent">Versendet</option>
              <option value="negotiating">Verhandlung</option>
              <option value="won">Gewonnen</option>
              <option value="lost">Verloren</option>
            </select>
          </Field>
          <Field label="Entscheidung bis">
            <input type="date" className="input" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function EditOfferModal({ offer, onClose, onSaved }: {
  offer: Offer; onClose: () => void; onSaved: (fields: Partial<Offer>) => void;
}) {
  const [client, setClient] = useState(offer.client_name);
  const [title, setTitle] = useState(offer.title);
  const [value, setValue] = useState(offer.estimated_value_cents ? String(offer.estimated_value_cents / 100) : '');
  const [probability, setProbability] = useState(offer.probability_pct != null ? String(offer.probability_pct) : '50');
  const [status, setStatus] = useState(offer.status);
  const [decisionDate, setDecisionDate] = useState(offer.decision_expected_date || '');
  const [notes, setNotes] = useState(offer.notes || '');

  function save() {
    onSaved({
      client_name: client.trim(),
      title: title.trim(),
      estimated_value_cents: value ? parseMoneyToCents(value) : null,
      probability_pct: probability ? parseInt(probability) : null,
      status: status as Offer['status'],
      decision_expected_date: decisionDate || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    });
  }

  return (
    <Modal open onClose={onClose} title="Angebot bearbeiten" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={save} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <Field label="Kundin"><input className="input" value={client} onChange={(e) => setClient(e.target.value)} autoFocus /></Field>
        <Field label="Titel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Geschätzter Wert (€)">
            <input type="text" inputMode="decimal" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Wahrscheinlichkeit (%)">
            <input type="number" min="0" max="100" className="input" value={probability} onChange={(e) => setProbability(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Offer['status'])}>
              <option value="draft">Entwurf</option>
              <option value="sent">Versendet</option>
              <option value="negotiating">Verhandlung</option>
              <option value="won">Gewonnen</option>
              <option value="lost">Verloren</option>
            </select>
          </Field>
          <Field label="Entscheidung bis">
            <input type="date" className="input" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notizen">
          <textarea className="input min-h-[80px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Offer PDF Generation
// ---------------------------------------------------------------------------

async function generateOfferPdf(offer: Offer, action: 'download' | 'archive' = 'download') {
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

  // Header band
  doc.setFillColor(...petrol);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 34, pageWidth, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('ANGEBOT', margin, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(225, 216, 208);
  doc.text('Projekt- & Preiskalkulation', margin, 25);
  doc.setFontSize(8);
  doc.text(`Angebot-Nr. OFF-${offer.id.slice(0, 6).toUpperCase()}`, pageWidth - margin, 18, { align: 'right' });

  doc.setTextColor(...ink);
  let y = 48;

  // Sender / Recipient
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text('VON', margin, y);
  doc.text('AN', pageWidth / 2 + 6, y);
  y += 5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text(owner.name || 'Dein Name', margin, y);
  doc.text(offer.client_name, pageWidth / 2 + 6, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);

  let leftY = y + 5;
  let rightY = y + 5;
  if (owner.company) { doc.text(owner.company, margin, leftY); leftY += 4.6; }
  owner.address?.split('\n').forEach((line: string) => { doc.text(line, margin, leftY); leftY += 4.6; });
  if (owner.email) { doc.text(owner.email, margin, leftY); leftY += 4.6; }

  doc.setTextColor(...ink);
  y = Math.max(leftY, rightY) + 10;

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // Offer Details
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...bordeaux);
  doc.text('ANGEBOTSDETAILS', margin, y);
  y += 8;

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text('Projekt:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(offer.title, margin + 45, y);
  y += 6;

  if (offer.estimated_value_cents) {
    doc.setFont('helvetica', 'bold');
    doc.text('Geschätzter Wert:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formatMoney(offer.estimated_value_cents), margin + 45, y);
    y += 6;
  }

  if (offer.decision_expected_date) {
    doc.setFont('helvetica', 'bold');
    doc.text('Entscheidung bis:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDate(offer.decision_expected_date), margin + 45, y);
    y += 6;
  }

  y += 4;

  if (offer.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...bordeaux);
    doc.text('BESCHREIBUNG / LEISTUNGSUMFANG', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(70, 70, 70);
    const lines = doc.splitTextToSize(offer.notes, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 4.8 + 10;
  }

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
  doc.text(`Erstellt am ${formatDate(offer.created_at)}`, margin, pageHeight - 10);
  doc.text('Fundament Studio', pageWidth - margin, pageHeight - 10, { align: 'right' });

  if (action === 'download') {
    doc.save(`Angebot-${offer.title.replace(/\s+/g, '-')}.pdf`);
  } else {
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.split('base64,')[1];
    const docId = await uuid();
    await documents.insert({
      id: docId,
      entity_type: 'client',
      entity_id: offer.client_id || null,
      entity_name: offer.client_name,
      document_type: 'offer',
      title: `Angebot: ${offer.title}`,
      status: 'archived',
      file_name: `Angebot-${offer.title.replace(/\s+/g, '-')}.pdf`,
      file_data: base64,
      file_mime: 'application/pdf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);
    alert('Angebot wurde erfolgreich im Dokumentenarchiv archiviert.');
  }
}