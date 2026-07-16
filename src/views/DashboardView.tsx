import { useEffect, useState } from 'react';
import {
  TrendingUp, Clock, FolderKanban, AlertCircle, CalendarClock,
  Play, Plus, ArrowRight, CheckSquare, Flag,
} from 'lucide-react';
import { projects, timeEntries, invoices, offers, transactions, todos } from '../lib/db';
import type { Project, Invoice, Offer, TimeEntry, Transaction, Todo } from '../types';
import { formatMoney, formatMoneyShort, formatDuration, formatDate, relativeDeadline, startOfWeek, isoWeek } from '../lib/format';
import { useRunningTimer, startTimer } from '../lib/timer';
import { Badge, EmptyState } from '../components/ui';
import type { ViewId } from '../components/Sidebar';

function weekKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const ws = startOfWeek(d);
  return `${ws.getFullYear()}-W${String(isoWeek(ws)).padStart(2, '0')}`;
}

export function DashboardView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [invoiceList, setInvoiceList] = useState<Invoice[]>([]);
  const [offerList, setOfferList] = useState<Offer[]>([]);
  const [timeList, setTimeList] = useState<TimeEntry[]>([]);
  const [txList, setTxList] = useState<Transaction[]>([]);
  const [todoList, setTodoList] = useState<Todo[]>([]);
  const running = useRunningTimer();

  const currentWeek = weekKey(0);

  useEffect(() => {
    (async () => {
      setProjectList(await projects.list());
      setInvoiceList(await invoices.list());
      setOfferList(await offers.list());
      setTimeList(await timeEntries.list());
      setTxList(await transactions.list());
      setTodoList(await todos.byWeek(currentWeek));
    })();
  }, [running, currentWeek]);

  // --- derived metrics ---
  const activeProjects = projectList.filter(p => p.status === 'active');
  const openInvoices = invoiceList.filter(i => i.status === 'open' || i.status === 'overdue');
  const openOffers = offerList.filter(o => o.status === 'sent' || o.status === 'negotiating');
  const overdueInvoices = invoiceList.filter(i => i.status === 'overdue' || (i.status === 'open' && i.due_date && new Date(i.due_date) < new Date()));

  // This week's tracked minutes
  const weekStart = startOfWeek(new Date());
  const weekMinutes = timeList
    .filter(t => new Date(t.entry_date) >= weekStart)
    .reduce((sum, t) => sum + t.minutes, 0);

  // Month cashflow
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTx = txList.filter(t => new Date(t.transaction_date) >= monthStart);
  const monthIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount_cents, 0);
  const monthExpense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount_cents, 0);
  const monthBalance = monthIncome - monthExpense;

  // Weighted pipeline (sum of estimated_value * probability)
  const pipelineWeighted = openOffers.reduce((s, o) => s + (o.estimated_value_cents || 0) * (o.probability_pct || 0) / 100, 0);

  // This week's todos
  const openTodos = todoList.filter(t => t.status !== 'done').slice(0, 5);
  const todoDoneCount = todoList.filter(t => t.status === 'done').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-ink-500">{now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="font-display text-2xl font-medium text-ink-900 mt-0.5">Willkommen zurück</h1>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Aktive Projekte"
          value={String(activeProjects.length)}
          icon={<FolderKanban size={18} />}
          tone="accent"
          onClick={() => onNavigate('projects')}
        />
        <KpiCard
          label="Diese Woche erfasst"
          value={formatDuration(weekMinutes)}
          icon={<Clock size={18} />}
          tone="info"
          onClick={() => onNavigate('time')}
        />
        <KpiCard
          label="Offene Rechnungen"
          value={String(openInvoices.length)}
          sub={formatMoneyShort(openInvoices.reduce((s, i) => s + i.amount_cents, 0))}
          icon={<AlertCircle size={18} />}
          tone={overdueInvoices.length > 0 ? 'danger' : 'warning'}
          onClick={() => onNavigate('invoices')}
        />
        <KpiCard
          label="Gewichtete Pipeline"
          value={formatMoneyShort(Math.round(pipelineWeighted))}
          sub={`${openOffers.length} Angebote offen`}
          icon={<TrendingUp size={18} />}
          tone="success"
          onClick={() => onNavigate('finances')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active projects */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Aktive Projekte</h2>
            <button onClick={() => onNavigate('projects')} className="btn-ghost text-sm">
              Alle <ArrowRight size={14} />
            </button>
          </div>
          {activeProjects.length === 0 ? (
            <EmptyState icon={<FolderKanban size={24} />} title="Keine aktiven Projekte" hint="Lege ein neues Projekt an, um zu starten." />
          ) : (
            <div className="space-y-2">
              {activeProjects.slice(0, 5).map(p => {
                const dl = relativeDeadline(p.target_end_date);
                return (
                  <button
                    key={p.id}
                    onClick={() => onNavigate('projects')}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surfaceAlt transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{p.name}</p>
                      <p className="text-2xs text-ink-500">{p.client_name || 'Keine Kundin'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {p.target_end_date && (
                        <Badge tone={dl.tone === 'overdue' ? 'danger' : dl.tone === 'soon' ? 'warning' : 'neutral'}>
                          <CalendarClock size={12} /> {dl.label}
                        </Badge>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); startTimer('project', p.id, p.name); }}
                        className="p-1.5 rounded-md text-accent-600 hover:bg-accent-50"
                        title="Timer starten"
                      >
                        <Play size={14} />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Month cashflow */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Cashflow (lfd. Monat)</h2>
          <div className="space-y-3">
            <CashRow label="Einnahmen" value={monthIncome} tone="success" />
            <CashRow label="Ausgaben" value={monthExpense} tone="danger" />
            <div className="h-px bg-line my-1" />
            <CashRow label="Saldo" value={monthBalance} tone={monthBalance >= 0 ? 'accent' : 'danger'} bold />
          </div>
          <button onClick={() => onNavigate('finances')} className="btn-outline w-full mt-4 text-sm">
            Finanzen öffnen <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* This week's todos */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">To-dos diese Woche</h2>
            <div className="flex items-center gap-2">
              {openTodos.length > 0 && <Badge tone="neutral">{openTodos.length} offen</Badge>}
              {todoDoneCount > 0 && <Badge tone="success">{todoDoneCount} erledigt</Badge>}
            </div>
          </div>
          {openTodos.length === 0 ? (
            <EmptyState icon={<CheckSquare size={24} />} title="Keine offenen To-dos" hint="Füge Aufgaben in der To-do-Ansicht hinzu." />
          ) : (
            <div className="space-y-1.5">
              {openTodos.map(t => (
                <button
                  key={t.id}
                  onClick={() => onNavigate('todos')}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surfaceAlt transition-colors text-left"
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    t.status === 'in_progress' ? 'border-accent-500 bg-accent-50' : 'border-line'
                  }`}>
                    {t.status === 'in_progress' && <Clock size={10} className="text-accent-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate">{t.title}</p>
                    {t.due_date && (
                      <p className="text-2xs text-ink-500">{formatDate(t.due_date)}</p>
                    )}
                  </div>
                  {t.priority === 'high' && <Flag size={12} className="text-danger-500" />}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => onNavigate('todos')} className="btn-outline w-full mt-4 text-sm">
            Alle To-dos <ArrowRight size={14} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Schnellzugriff</h2>
          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={<Plus size={16} />} label="Neues Projekt" onClick={() => onNavigate('projects')} />
            <QuickAction icon={<Play size={16} />} label="Timer starten" onClick={() => onNavigate('time')} />
            <QuickAction icon={<Plus size={16} />} label="Rechnung" onClick={() => onNavigate('invoices')} />
            <QuickAction icon={<Plus size={16} />} label="To-do" onClick={() => onNavigate('todos')} />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, tone, onClick }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone: 'accent' | 'info' | 'warning' | 'danger' | 'success'; onClick?: () => void;
}) {
  const toneBg: Record<string, string> = {
    accent: 'bg-accent-50 text-accent-600',
    info: 'bg-info-50 text-info-600',
    warning: 'bg-warning-50 text-warning-600',
    danger: 'bg-danger-50 text-danger-600',
    success: 'bg-success-50 text-success-600',
  };
  return (
    <button onClick={onClick} className="card card-hover p-5 text-left transition-all">
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${toneBg[tone]}`}>{icon}</div>
      </div>
      <p className="mt-3 text-2xs font-semibold uppercase tracking-wider text-ink-500">{label}</p>
      <p className="stat-value mt-1">{value}</p>
      {sub && <p className="text-2xs text-ink-400 mt-0.5">{sub}</p>}
    </button>
  );
}

function CashRow({ label, value, tone, bold }: { label: string; value: number; tone: 'success' | 'danger' | 'accent'; bold?: boolean }) {
  const color = tone === 'success' ? 'text-success-700' : tone === 'danger' ? 'text-danger-600' : 'text-accent-700';
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${color}`}>{formatMoney(value)}</span>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-outline justify-start px-4 py-3 text-sm">
      {icon} {label}
    </button>
  );
}
