// Database service layer — thin wrapper around the Electron IPC bridge.
// In the browser (Vite dev server without Electron) it falls back to an
// in-memory mock so the UI is still clickable during development.

import type {
  Project, ProjectPhase, ProjectChecklistItem, ProjectAsset,
  Transaction, Invoice, Offer, HourlyRateCalculation, AnnualGoal,
  SocialPost, SocialPostAsset, SocialPostTimeEntry,
  TimeEntry, AppSetting, PhaseTemplate, PhaseTemplateItem, ChecklistTemplateItem,
  ProjectPriceCalc, Goal, Todo, Client, ClientOnboardingItem, Contract, Avv, Document, Note
} from '../types';

// Electron bridge shape (from preload.cjs)
interface StudioBridge {
  db: {
    all: (sql: string, params?: unknown[]) => Promise<unknown[]>;
    get: (sql: string, params?: unknown[]) => Promise<unknown | undefined>;
    run: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number | string }>;
    transaction: (statements: { sql: string; params?: unknown[] }[]) => Promise<unknown[]>;
    backup: () => Promise<{ ok: boolean; path?: string; reason?: string }>;
  };
  util: { uuid: () => Promise<string> };
}

function bridge(): StudioBridge | null {
  return (window as unknown as { studio?: StudioBridge }).studio ?? null;
}

export const isElectron = () => bridge() !== null;

// ---------------------------------------------------------------------------
// UUID
// ---------------------------------------------------------------------------

export async function uuid(): Promise<string> {
  const b = bridge();
  if (b) return b.util.uuid();
  return (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const b = bridge();
  if (b) return b.db.all(sql, params) as Promise<T[]>;
  return mockAll<T>(sql, params);
}

export async function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const b = bridge();
  if (b) return b.db.get(sql, params) as Promise<T | undefined>;
  return mockGet<T>(sql, params);
}

export async function run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number | string }> {
  const b = bridge();
  if (b) return b.db.run(sql, params);
  return mockRun(sql, params);
}

export async function tx(statements: { sql: string; params?: unknown[] }[]): Promise<unknown[]> {
  const b = bridge();
  if (b) return b.db.transaction(statements);
  for (const s of statements) await mockRun(s.sql, s.params || []);
  return [];
}

export async function backup(): Promise<{ ok: boolean; path?: string; reason?: string }> {
  const b = bridge();
  if (b) return b.db.backup();
  return { ok: false, reason: 'not-electron' };
}

export async function restore(): Promise<{ ok: boolean; reason?: string }> {
  const b = bridge();
  if (b) return b.db.backup().then(() => ({ ok: false, reason: 'restore-not-available' }));
  return { ok: false, reason: 'not-electron' };
}

export async function resetDatabase(): Promise<{ ok: boolean; reason?: string }> {
  return { ok: false, reason: 'not-available' };
}

// ---------------------------------------------------------------------------
// Domain-specific convenience queries
// ---------------------------------------------------------------------------

export const projects = {
  list: () => all<Project>('SELECT * FROM projects ORDER BY created_at DESC'),
  all: () => all<Project>('SELECT * FROM projects ORDER BY created_at DESC'),
  get: (id: string) => get<Project>('SELECT * FROM projects WHERE id = ?', [id]),
  insert: (p: Project) => run(
    `INSERT INTO projects (id, name, client_id, client_name, client_company, client_email, client_phone, client_address, template_id, status, start_date, target_end_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.name, p.client_id ?? null, p.client_name, p.client_company, p.client_email, p.client_phone, p.client_address, p.template_id, p.status, p.start_date, p.target_end_date, p.notes]
  ),
  update: (id: string, fields: Partial<Project>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE projects SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM projects WHERE id = ?', [id]),
};

export const phases = {
  listByProject: (projectId: string) =>
    all<ProjectPhase>('SELECT * FROM project_phases WHERE project_id = ? ORDER BY COALESCE(position_override, 9999), created_at', [projectId]),
  listActive: () =>
    all<ProjectPhase>("SELECT * FROM project_phases WHERE status IN ('open', 'in_progress') ORDER BY deadline, created_at"),
  insert: (p: ProjectPhase) => run(
    `INSERT INTO project_phases (id, project_id, phase_template_item_id, name_override, status, deadline, position_override, estimated_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.project_id, p.phase_template_item_id, p.name_override, p.status, p.deadline, p.position_override, p.estimated_hours]
  ),
  update: (id: string, fields: Partial<ProjectPhase>) => {
    const keys = Object.keys(fields).filter(
      k => k !== 'id' && k !== 'created_at' && k !== 'project_id' && k !== 'updated_at'
    );
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(
      `UPDATE project_phases SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [...vals, id]
    );
  },
  remove: (id: string) => run('DELETE FROM project_phases WHERE id = ?', [id]),
};

export const checklist = {
  listByPhase: (phaseId: string) =>
    all<ProjectChecklistItem>('SELECT * FROM project_checklist_items WHERE project_phase_id = ? ORDER BY COALESCE(position_override, 9999), created_at', [phaseId]),
  insert: (c: ProjectChecklistItem) => run(
    `INSERT INTO project_checklist_items (id, project_phase_id, checklist_template_item_id, label_override, is_checked, position_override)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [c.id, c.project_phase_id, c.checklist_template_item_id, c.label_override, c.is_checked, c.position_override]
  ),
  toggle: (id: string, checked: number) => run(
    `UPDATE project_checklist_items SET is_checked = ?, checked_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id = ?`,
    [checked, checked, id]
  ),
  remove: (id: string) => run('DELETE FROM project_checklist_items WHERE id = ?', [id]),
};

export const assets = {
  listByProject: (projectId: string) =>
    all<ProjectAsset>('SELECT * FROM project_assets WHERE project_id = ? ORDER BY created_at DESC', [projectId]),
  insert: (a: ProjectAsset) => run(
    `INSERT INTO project_assets (id, project_id, project_phase_id, type, label, value, file_name, file_mime, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.project_id, a.project_phase_id, a.type, a.label, a.value, a.file_name, a.file_mime, a.file_size]
  ),
  remove: (id: string) => run('DELETE FROM project_assets WHERE id = ?', [id]),
};

export const recurring = {
  list: () => all<any>('SELECT * FROM recurring_transactions ORDER BY next_date ASC'),
  listBySupplier: (supplierId: string) =>
    all<any>('SELECT * FROM recurring_transactions WHERE supplier_id = ? ORDER BY next_date ASC', [supplierId]),
  dueNow: () =>
    all<any>("SELECT * FROM recurring_transactions WHERE active = 1 AND next_date <= date('now') ORDER BY next_date ASC"),
  insert: (r: any) => run(
    `INSERT INTO recurring_transactions (id, type, amount_cents, currency, description, category, project_id, frequency, next_date, last_generated, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.id, r.type, r.amount_cents, r.currency, r.description, r.category, r.project_id, r.frequency, r.next_date, r.last_generated ?? null, r.active ?? 1]
  ),
  update: (id: string, fields: Partial<any>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE recurring_transactions SET ${set} WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM recurring_transactions WHERE id = ?', [id]),
  nextDateFor(currentDate: string, frequency: string): string {
    const d = new Date(currentDate + 'T00:00:00Z');
    if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
    else if (frequency === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
    else if (frequency === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  },
  async confirmOne(r: any, bookingDate?: string): Promise<void> {
    const txId = await uuid();
    const date = bookingDate || r.next_date;
    const nextDate = recurring.nextDateFor(r.next_date, r.frequency);
    await tx([
      {
        sql: `INSERT INTO transactions (id, type, amount_cents, currency, description, category, project_id, transaction_date, reference_type, reference_id, recurring_id, tax_rate_pct, net_amount_cents, tax_amount_cents)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recurring', ?, ?, ?, ?, ?)`,
        params: [txId, r.type, r.amount_cents, r.currency, r.description, r.category, r.project_id, date, r.id, r.id, null, null, null],
      },
      {
        sql: `UPDATE recurring_transactions SET next_date = ?, last_generated = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        params: [nextDate, r.id],
      },
    ]);
  },
  async confirmMany(items: any[]): Promise<void> {
    for (const r of items) await recurring.confirmOne(r);
  },
  async skipOne(r: any): Promise<void> {
    const nextDate = recurring.nextDateFor(r.next_date, r.frequency);
    await run(`UPDATE recurring_transactions SET next_date = ? WHERE id = ?`, [nextDate, r.id]);
  },
};

export const suppliers = {
  list: () => all<any>('SELECT * FROM suppliers ORDER BY name'),
  active: () => all<any>('SELECT * FROM suppliers WHERE active = 1 ORDER BY name'),
  insert: (s: any) => run(
    `INSERT INTO suppliers (id, name, category, monthly_cost_cents, billing_cycle, notice_period_days, contract_end_date, url, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.id, s.name, s.category, s.monthly_cost_cents, s.billing_cycle, s.notice_period_days, s.contract_end_date, s.url, s.notes, s.active]
  ),
  update: (id: string, fields: Partial<any>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE suppliers SET ${set} WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM suppliers WHERE id = ?', [id]),
  async insertWithRecurring(s: any, asRecurring: boolean, firstDueDate?: string): Promise<void> {
    await suppliers.insert(s);
    if (!asRecurring) return;
    const recurringId = await uuid();
    const frequency = s.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const nextDate = firstDueDate || new Date().toISOString().slice(0, 10);
    await recurring.insert({
      id: recurringId,
      type: 'expense',
      amount_cents: s.monthly_cost_cents,
      currency: 'EUR',
      description: s.name,
      category: s.category || 'Lieferanten',
      project_id: null,
      frequency,
      next_date: nextDate,
      supplier_id: s.id,
      active: 1,
      last_generated: null,
    });
  },
};

export const transactions = {
  list: () => all<Transaction>('SELECT * FROM transactions ORDER BY transaction_date DESC, created_at DESC'),
  insert: (t: Transaction) => run(
    `INSERT INTO transactions (id, type, amount_cents, currency, description, category, project_id, transaction_date, reference_type, reference_id, recurring_id, tax_rate_pct, net_amount_cents, tax_amount_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.id, t.type, t.amount_cents, t.currency, t.description, t.category, t.project_id, t.transaction_date, t.reference_type, t.reference_id, t.recurring_id, t.tax_rate_pct ?? null, t.net_amount_cents ?? null, t.tax_amount_cents ?? null]
  ),
  remove: (id: string) => run('DELETE FROM transactions WHERE id = ?', [id]),
};

export const invoices = {
  list: () => all<Invoice>('SELECT * FROM invoices ORDER BY issued_date DESC, created_at DESC'),
  all: () => all<Invoice>('SELECT * FROM invoices ORDER BY issued_date DESC, created_at DESC'),
  get: (id: string) => get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]),
  byYear: (year: number) => all<Invoice>(
    'SELECT * FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number ASC',
    [`${year}-%`]
  ),
  nextNumber: async (year: number): Promise<string> => {
    const list = await all<Invoice>(
      'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1',
      [`${year}-%`]
    );
    if (list.length === 0 || !list[0].invoice_number) return `${year}-001`;
    const last = list[0].invoice_number;
    const num = parseInt(last.split('-')[1] || '0', 10);
    return `${year}-${String(num + 1).padStart(3, '0')}`;
  },
  insert: (i: Invoice) => run(
    `INSERT INTO invoices (
       id, project_id, offer_id, invoice_number, client_name, client_id,
       client_company, client_address, client_email,
       positions_json, subtotal_cents, tax_rate_pct, tax_amount_cents, total_cents, amount_cents,
       currency, status, issued_date, due_date,
       paid_date, paid_transaction_id, cancelled_at, cancel_reason, original_invoice_id,
       avv_accepted, avv_accepted_at, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      i.id, i.project_id ?? null, (i as any).offer_id ?? null, i.invoice_number, i.client_name, i.client_id ?? null,
      (i as any).client_company ?? null, (i as any).client_address ?? null, (i as any).client_email ?? null,
      (i as any).positions_json ?? '[]', (i as any).subtotal_cents ?? 0, (i as any).tax_rate_pct ?? 19, (i as any).tax_amount_cents ?? 0,
      (i as any).total_cents ?? 0, (i as any).total_cents ?? 0,
      i.currency, i.status, i.issued_date, i.due_date ?? null,
      (i as any).paid_date ?? null, (i as any).paid_transaction_id ?? null, (i as any).cancelled_at ?? null,
      (i as any).cancel_reason ?? null, (i as any).original_invoice_id ?? null,
      (i as any).avv_accepted ?? 0, (i as any).avv_accepted_at ?? null, i.notes ?? null,
    ]
  ),
  update: (id: string, fields: Partial<Invoice>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE invoices SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  cancel: (id: string, reason: string) => invoices.update(id, {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancel_reason: reason,
  } as Partial<Invoice>),
  remove: (id: string) => run('DELETE FROM invoices WHERE id = ?', [id]),
};

export const offers = {
  list: () => all<Offer>('SELECT * FROM offers ORDER BY created_at DESC'),
  insert: (o: Offer) => run(
    `INSERT INTO offers (id, client_name, title, estimated_value_cents, probability_pct, status, sent_date, decision_expected_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.id, o.client_name, o.title, o.estimated_value_cents, o.probability_pct, o.status, o.sent_date, o.decision_expected_date, o.notes]
  ),
  update: (id: string, fields: Partial<Offer>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE offers SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM offers WHERE id = ?', [id]),
};

export const hourly = {
  list: () => all<HourlyRateCalculation>('SELECT * FROM hourly_rate_calculations ORDER BY created_at DESC'),
  insert: (h: HourlyRateCalculation) => run(
    `INSERT INTO hourly_rate_calculations (id, label, desired_annual_income_cents, business_costs_annual_cents, billable_hours_per_week, weeks_per_year, buffer_pct, result_hourly_rate_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.id, h.label, h.desired_annual_income_cents, h.business_costs_annual_cents, h.billable_hours_per_week, h.weeks_per_year, h.buffer_pct, h.result_hourly_rate_cents]
  ),
  remove: (id: string) => run('DELETE FROM hourly_rate_calculations WHERE id = ?', [id]),
};

export const goals = {
  list: () => all<AnnualGoal>('SELECT * FROM annual_goals ORDER BY year DESC'),
  upsert: (g: AnnualGoal) => run(
    `INSERT INTO annual_goals (id, year, target_revenue_cents, target_project_count, target_hourly_rate_cents, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(year) DO UPDATE SET
       target_revenue_cents = excluded.target_revenue_cents,
       target_project_count = excluded.target_project_count,
       target_hourly_rate_cents = excluded.target_hourly_rate_cents,
       notes = excluded.notes`,
    [g.id, g.year, g.target_revenue_cents, g.target_project_count, g.target_hourly_rate_cents, g.notes]
  ),
};

export const templates = {
  list: () => all<PhaseTemplate>('SELECT * FROM phase_templates ORDER BY name'),
  get: (id: string) => get<PhaseTemplate>('SELECT * FROM phase_templates WHERE id = ?', [id]),
  insert: (t: PhaseTemplate) => run(
    `INSERT INTO phase_templates (id, name, description, is_system) VALUES (?, ?, ?, 0)`,
    [t.id, t.name, t.description]
  ),
  update: (id: string, fields: Partial<PhaseTemplate>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at' && k !== 'is_system');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE phase_templates SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM phase_templates WHERE id = ? AND is_system = 0', [id]),
  items: (templateId: string) =>
    all<PhaseTemplateItem>('SELECT * FROM phase_template_items WHERE template_id = ? ORDER BY position', [templateId]),
  addItem: (item: PhaseTemplateItem) => run(
    `INSERT INTO phase_template_items (id, template_id, name, description, position) VALUES (?, ?, ?, ?, ?)`,
    [item.id, item.template_id, item.name, item.description, item.position]
  ),
  updateItem: (id: string, fields: Partial<PhaseTemplateItem>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE phase_template_items SET ${set} WHERE id = ?`, [...vals, id]);
  },
  removeItem: (id: string) => run('DELETE FROM phase_template_items WHERE id = ?', [id]),
  checklistItems: (phaseTemplateItemId: string) =>
    all<ChecklistTemplateItem>('SELECT * FROM checklist_template_items WHERE phase_template_item_id = ? ORDER BY position', [phaseTemplateItemId]),
  addChecklistItem: (item: ChecklistTemplateItem) => run(
    `INSERT INTO checklist_template_items (id, phase_template_item_id, label, position) VALUES (?, ?, ?, ?)`,
    [item.id, item.phase_template_item_id, item.label, item.position]
  ),
  removeChecklistItem: (id: string) => run('DELETE FROM checklist_template_items WHERE id = ?', [id]),
};

export const posts = {
  list: () => all<SocialPost>('SELECT * FROM social_posts ORDER BY COALESCE(scheduled_date, created_at) DESC'),
  insert: (p: SocialPost) => run(
    `INSERT INTO social_posts (id, template_id, platform, format, topic, caption, status, scheduled_date, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.template_id, p.platform, p.format, p.topic, p.caption, p.status, p.scheduled_date, p.project_id]
  ),
  update: (id: string, fields: Partial<SocialPost>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE social_posts SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM social_posts WHERE id = ?', [id]),
};

export const postAssets = {
  listByPost: (postId: string) => all<SocialPostAsset>('SELECT * FROM social_post_assets WHERE post_id = ? ORDER BY created_at DESC', [postId]),
  insert: (a: SocialPostAsset) => run(
    `INSERT INTO social_post_assets (id, post_id, type, label, value) VALUES (?, ?, ?, ?, ?)`,
    [a.id, a.post_id, a.type, a.label, a.value]
  ),
  remove: (id: string) => run('DELETE FROM social_post_assets WHERE id = ?', [id]),
};

export const postTime = {
  listByPost: (postId: string) => all<SocialPostTimeEntry>('SELECT * FROM social_post_time_entries WHERE post_id = ? ORDER BY entry_date DESC', [postId]),
  insert: (e: SocialPostTimeEntry) => run(
    `INSERT INTO social_post_time_entries (id, post_id, minutes, entry_date, note) VALUES (?, ?, ?, ?, ?)`,
    [e.id, e.post_id, e.minutes, e.entry_date, e.note]
  ),
  remove: (id: string) => run('DELETE FROM social_post_time_entries WHERE id = ?', [id]),
};


export const metrics = {
  listByPost: (postId: string) => all<any>('SELECT * FROM social_post_metrics WHERE post_id = ? ORDER BY snapshot_date DESC', [postId]),
  all: () => all<any>('SELECT * FROM social_post_metrics ORDER BY snapshot_date DESC'),
  insert: (m: any) => run(
    `INSERT INTO social_post_metrics (id, post_id, snapshot_date, impressions, reach, likes, comments, shares, saves, clicks, profile_visits, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.id, m.post_id, m.snapshot_date, m.impressions, m.reach, m.likes, m.comments, m.shares, m.saves, m.clicks, m.profile_visits, m.notes]
  ),
  remove: (id: string) => run('DELETE FROM social_post_metrics WHERE id = ?', [id]),
};

export const timeEntries = {
  list: () => all<TimeEntry>('SELECT * FROM time_entries ORDER BY entry_date DESC, created_at DESC'),
  insert: (e: TimeEntry) => run(
    `INSERT INTO time_entries (id, entity_type, entity_id, minutes, entry_date, note) VALUES (?, ?, ?, ?, ?, ?)`,
    [e.id, e.entity_type, e.entity_id, e.minutes, e.entry_date, e.note]
  ),
  remove: (id: string) => run('DELETE FROM time_entries WHERE id = ?', [id]),
};

export const priceCalcs = {
  list: () => all<ProjectPriceCalc>('SELECT * FROM project_price_calcs ORDER BY created_at DESC'),
  insert: (p: ProjectPriceCalc) => run(
    `INSERT INTO project_price_calcs (id, label, client_name, positions_json, extra_costs_json, discount_cents, buffer_pct, subtotal_cents, total_cents, total_hours, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.label, p.client_name, p.positions_json, p.extra_costs_json, p.discount_cents, p.buffer_pct, p.subtotal_cents, p.total_cents, p.total_hours, p.notes]
  ),
  update: (id: string, fields: Partial<ProjectPriceCalc>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE project_price_calcs SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM project_price_calcs WHERE id = ?', [id]),
};

export const goals2 = {
  list: () => all<Goal>('SELECT * FROM goals ORDER BY period_type, period_key DESC, created_at DESC'),
  byPeriod: (periodType: string, periodKey: string) =>
    all<Goal>('SELECT * FROM goals WHERE period_type = ? AND period_key = ? ORDER BY created_at DESC', [periodType, periodKey]),
  insert: (g: Goal) => run(
    `INSERT INTO goals (id, title, period_type, period_key, target_value, current_value, unit, category, notes, is_completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [g.id, g.title, g.period_type, g.period_key, g.target_value, g.current_value, g.unit, g.category, g.notes]
  ),
  update: (id: string, fields: Partial<Goal>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE goals SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM goals WHERE id = ?', [id]),
};

// --- Ersetze den todos-Block in src/lib/db.ts durch diesen ---

export const todos = {
  list: () => all<Todo>('SELECT * FROM todos ORDER BY week_key DESC NULLS LAST, position, created_at DESC'),
  byWeek: (weekKey: string) =>
    all<Todo>('SELECT * FROM todos WHERE week_key = ? ORDER BY position, created_at', [weekKey]),
  unassigned: () =>
    all<Todo>("SELECT * FROM todos WHERE week_key IS NULL AND status != 'done' ORDER BY priority DESC, created_at DESC"),
  insert: (t: Todo) => run(
    `INSERT INTO todos (id, title, description, status, priority, due_date, week_key, sprint_id, project_id, social_post_id, position, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.id, t.title, t.description, t.status, t.priority, t.due_date, t.week_key, (t as any).sprint_id ?? null, t.project_id, t.social_post_id, t.position, (t as any).category ?? null]
  ),
  update: (id: string, fields: Partial<Todo>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE todos SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM todos WHERE id = ?', [id]),
};

export const clients = {
  list: () => all<Client>('SELECT * FROM clients ORDER BY name'),
  get: (id: string) => get<Client>('SELECT * FROM clients WHERE id = ?', [id]),
  insert: (c: Client) => run(
    `INSERT INTO clients (id, name, company, email, phone, address, tax_id, onboarding_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.id, c.name, c.company, c.email, c.phone, c.address, c.tax_id, c.onboarding_status, c.notes]
  ),
  update: (id: string, fields: Partial<Client>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE clients SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM clients WHERE id = ?', [id]),
};

export const onboarding = {
  listByClient: (clientId: string) =>
    all<ClientOnboardingItem>('SELECT * FROM client_onboarding_items WHERE client_id = ? ORDER BY position, created_at', [clientId]),
  insert: (item: ClientOnboardingItem) => run(
    `INSERT INTO client_onboarding_items (id, client_id, label, is_checked, position) VALUES (?, ?, ?, ?, ?)`,
    [item.id, item.client_id, item.label, item.is_checked, item.position]
  ),
  toggle: (id: string, checked: number) => run(
    `UPDATE client_onboarding_items SET is_checked = ?, checked_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id = ?`,
    [checked, checked, id]
  ),
  remove: (id: string) => run('DELETE FROM client_onboarding_items WHERE id = ?', [id]),
};

export const contracts = {
  list: () => all<Contract>('SELECT * FROM contracts ORDER BY created_at DESC'),
  byClient: (clientId: string) =>
    all<Contract>('SELECT * FROM contracts WHERE client_id = ? ORDER BY created_at DESC', [clientId]),
  insert: (c: Contract) => run(
    `INSERT INTO contracts (id, client_id, title, monthly_amount_cents, start_date, end_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.id, c.client_id, c.title, c.monthly_amount_cents, c.start_date, c.end_date, c.status, c.notes]
  ),
  update: (id: string, fields: Partial<Contract>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at' && k !== 'client_id');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE contracts SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM contracts WHERE id = ?', [id]),
};

export const avvs = {
  list: () => all<Avv>('SELECT * FROM avvs ORDER BY created_at DESC'),
  byClient: (clientId: string) =>
    all<Avv>('SELECT * FROM avvs WHERE client_id = ? ORDER BY created_at DESC', [clientId]),
  get: (id: string) => get<Avv>('SELECT * FROM avvs WHERE id = ?', [id]),
  insert: (a: Avv) => run(
    `INSERT INTO avvs (id, client_id, client_name, client_company, client_address, client_email, title, description, data_categories, data_purpose, data_retention, security_measures, status, sent_date, signed_date, valid_until, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.client_id, a.client_name, a.client_company, a.client_address, a.client_email, a.title, a.description, a.data_categories, a.data_purpose, a.data_retention, a.security_measures, a.status, a.sent_date, a.signed_date, a.valid_until, a.notes]
  ),
  update: (id: string, fields: Partial<Avv>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE avvs SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM avvs WHERE id = ?', [id]),
};

export const documents = {
  list: () => all<Document>('SELECT * FROM documents ORDER BY created_at DESC'),
  byEntity: (entityType: string, entityId: string | null) =>
    entityId
      ? all<Document>('SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', [entityType, entityId])
      : all<Document>('SELECT * FROM documents WHERE entity_type = ? AND entity_id IS NULL ORDER BY created_at DESC', [entityType]),
  byClient: (clientId: string) => all<Document>('SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['client', clientId]),
  byProject: (projectId: string) => all<Document>('SELECT * FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', ['project', projectId]),
  insert: (d: Document) => run(
    `INSERT INTO documents (id, entity_type, entity_id, entity_name, document_type, title, version, status, file_name, file_path, file_data, file_mime, file_size, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id, d.entity_type, d.entity_id, d.entity_name, d.document_type, 
      d.title, d.version, d.status, d.file_name, d.file_path, 
      d.file_data, d.file_mime, d.file_size, d.notes, 
      d.created_at || new Date().toISOString(), 
      d.updated_at || new Date().toISOString()
    ]
  ),
  update: (id: string, fields: Partial<Document>) => {
    const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
    if (keys.length === 0) return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
    const set = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => (fields as Record<string, unknown>)[k]);
    return run(`UPDATE documents SET ${set}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...vals, id]);
  },
  remove: (id: string) => run('DELETE FROM documents WHERE id = ?', [id]),
};

export const notes = {
  list: () =>
    all<Note>('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC'),

  get: (id: string) =>
    get<Note>('SELECT * FROM notes WHERE id = ?', [id]),

  insert: (n: Note) =>
    run(
      `INSERT INTO notes
      (id, title, content, category, tags, pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        n.id,
        n.title,
        n.content,
        n.category,
        n.tags,
        n.pinned,
        n.created_at,
        n.updated_at,
      ]
    ),

  update: (id: string, fields: Partial<Note>) => {
    const keys = Object.keys(fields).filter(
      k => k !== 'id' && k !== 'created_at'
    );

    if (!keys.length)
      return Promise.resolve({ changes: 0, lastInsertRowid: 0 });

    const set = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => (fields as any)[k]);

    return run(
      `UPDATE notes
       SET ${set},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
      [...values, id]
    );
  },

  remove: (id: string) =>
    run('DELETE FROM notes WHERE id = ?', [id]),
};

export const settings = {
  list: () => all<AppSetting>('SELECT * FROM app_settings'),
  get: (key: string) => get<AppSetting>('SELECT * FROM app_settings WHERE key = ?', [key]),
  set: (key: string, value: string) => run(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  ),
};

const DEFAULT_PLATFORMS = ['instagram', 'linkedin', 'tiktok', 'twitter', 'youtube', 'pinterest', 'facebook'];
const DEFAULT_FORMATS = ['carousel', 'reel', 'story', 'single_image', 'text', 'video', 'short'];

export async function getPlatforms(): Promise<string[]> {
  const row = await settings.get('social_platforms');
  if (row) { try { return JSON.parse(row.value); } catch { /* ignore */ } }
  return DEFAULT_PLATFORMS;
}

export async function setPlatforms(list: string[]): Promise<void> {
  await settings.set('social_platforms', JSON.stringify(list));
}

export async function getFormats(): Promise<string[]> {
  const row = await settings.get('social_formats');
  if (row) { try { return JSON.parse(row.value); } catch { /* ignore */ } }
  return DEFAULT_FORMATS;
}

export async function setFormats(list: string[]): Promise<void> {
  await settings.set('social_formats', JSON.stringify(list));
}
// --- Füge das in src/lib/db.ts unter getFormats / setFormats ein ---

const DEFAULT_PILLARS = ['education', 'inspiration', 'promotion', 'behind_the_scenes'];

export async function getPillars(): Promise<string[]> {
  const row = await settings.get('social_pillars');
  if (row) { try { return JSON.parse(row.value); } catch { /* ignore */ } }
  return DEFAULT_PILLARS;
}

export async function setPillars(list: string[]): Promise<void> {
  await settings.set('social_pillars', JSON.stringify(list));
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => escape(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportCsv(table: 'projects' | 'transactions' | 'invoices' | 'time_entries' | 'social_posts', filename?: string) {
  const rows = await all<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY created_at DESC`);
  const name = filename || `${table}-${new Date().toISOString().slice(0, 10)}.csv`;
  download(name, toCsv(rows), 'text/csv;charset=utf-8');
}

export async function exportJson(filename?: string) {
  const tables = [
    'projects', 'project_phases', 'project_checklist_items', 'project_assets',
    'recurring_transactions', 'transactions', 'invoices', 'offers',
    'hourly_rate_calculations', 'annual_goals', 'posts',
    'social_posts', 'social_post_assets', 'social_post_time_entries',
    'social_post_metrics', 'time_entries', 'project_price_calcs',
    'goals', 'todos', 'clients', 'client_onboarding_items', 'leads',
    'contracts', 'avvs', 'documents', 'suppliers', 'notes', 'app_settings',
    'phase_templates', 'phase_template_items', 'checklist_template_items', 'schema_migrations'
  ];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) {
    dump[t] = await all<Record<string, unknown>>(`SELECT * FROM ${t}`);
  }
  const name = filename || `studio-os-export-${new Date().toISOString().slice(0, 10)}.json`;
  download(name, JSON.stringify(dump, null, 2), 'application/json');
}

export async function exportEurCsv(year: number) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const txList = await all<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE transaction_date >= ? AND transaction_date <= ? ORDER BY transaction_date`,
    [start, end]
  );

  const rows: Record<string, unknown>[] = [];
  rows.push({ Kategorie: 'Einnahmen', Beschreibung: '', Datum: '', Betrag: '', USt: '' });
  for (const t of txList) {
    if (t.type === 'income') {
      rows.push({
        Kategorie: t.category || 'Sonstige Einnahmen',
        Beschreibung: t.description,
        Datum: t.transaction_date,
        Betrag: ((t.amount_cents as number) / 100).toFixed(2),
        USt: t.tax_rate_pct != null ? `${t.tax_rate_pct}%` : '',
      });
    }
  }
  rows.push({ Kategorie: '', Beschreibung: '', Datum: '', Betrag: '', USt: '' });
  rows.push({ Kategorie: 'Ausgaben', Beschreibung: '', Datum: '', Betrag: '', USt: '' });
  for (const t of txList) {
    if (t.type === 'expense') {
      rows.push({
        Kategorie: t.category || 'Sonstige Ausgaben',
        Beschreibung: t.description,
        Datum: t.transaction_date,
        Betrag: ((t.amount_cents as number) / 100).toFixed(2),
        USt: t.tax_rate_pct != null ? `${t.tax_rate_pct}%` : '',
      });
    }
  }

  const income = txList.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount_cents as number), 0);
  const expense = txList.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount_cents as number), 0);
  rows.push({ Kategorie: '', Beschreibung: '', Datum: '', Betrag: '', USt: '' });
  rows.push({ Kategorie: 'Summe Einnahmen', Beschreibung: '', Datum: '', Betrag: (income / 100).toFixed(2), USt: '' });
  rows.push({ Kategorie: 'Summe Ausgaben', Beschreibung: '', Datum: '', Betrag: (expense / 100).toFixed(2), USt: '' });
  rows.push({ Kategorie: 'Gewinn', Beschreibung: '', Datum: '', Betrag: ((income - expense) / 100).toFixed(2), USt: '' });

  download(`eur-${year}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

// ---------------------------------------------------------------------------
// MOCK FALLBACK
// ---------------------------------------------------------------------------

const mock: Record<string, unknown[]> = {};

function tableFor(sql: string): string {
  const m = sql.match(/FROM\s+(\w+)/i) || sql.match(/INTO\s+(\w+)/i) || sql.match(/UPDATE\s+(\w+)/i) || sql.match(/DELETE\s+FROM\s+(\w+)/i);
  return m ? m[1] : '_unknown';
}

async function mockAll<T>(sql: string, params: unknown[]): Promise<T[]> {
  const t = tableFor(sql);
  const rows = (mock[t] || []) as T[];
  const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
  if (whereMatch && params.length) {
    const col = whereMatch[1];
    return rows.filter(r => (r as Record<string, unknown>)[col] === params[0]);
  }
  return [...rows];
}

async function mockGet<T>(sql: string, params: unknown[]): Promise<T | undefined> {
  const rows = await mockAll<T>(sql, params);
  return rows[0];
}

async function mockRun(sql: string, params: unknown[]): Promise<{ changes: number; lastInsertRowid: number | string }> {
  const t = tableFor(sql);
  if (!mock[t]) mock[t] = [];
  if (/^INSERT/i.test(sql)) {
    const row: Record<string, unknown> = {};
    const cols = (sql.match(/\(([^)]+)\)/)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean);
    cols.forEach((c, i) => { row[c] = params[i]; });
    mock[t].push(row);
    return { changes: 1, lastInsertRowid: mock[t].length };
  }
  if (/^UPDATE/i.test(sql)) {
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/);
    if (whereMatch) {
      const col = whereMatch[1];
      const val = params[params.length - 1];
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i)?.[1] || '';
      const assignments = setMatch.split(',').map(s => s.trim());
      let changes = 0;
      mock[t].forEach((r) => {
        if ((r as Record<string, unknown>)[col] === val) {
          assignments.forEach((a) => {
            const [k] = a.split('=');
            (r as Record<string, unknown>)[k.trim()] = params[assignments.indexOf(a)];
          });
          changes++;
        }
      });
      return { changes, lastInsertRowid: 0 };
    }
  }
  if (/^DELETE/i.test(sql)) {
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/);
    if (whereMatch) {
      const col = whereMatch[1];
      const val = params[0];
      const before = mock[t].length;
      mock[t] = mock[t].filter(r => (r as Record<string, unknown>)[col] !== val);
      return { changes: before - mock[t].length, lastInsertRowid: 0 };
    }
  }
  return { changes: 0, lastInsertRowid: 0 };
}

// ===========================================================================
// AUTOMATISCHE SCHEMAAKTUALISIERUNG & TABELLEN-ERSTELLUNG (Self-Healing)
// ===========================================================================
if (isElectron()) {
  (async () => {
    try {
      await run(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          entity_name TEXT,
          document_type TEXT NOT NULL,
          title TEXT NOT NULL,
          version TEXT,
          status TEXT NOT NULL,
          file_name TEXT,
          file_path TEXT,
          file_data TEXT,
          file_mime TEXT,
          file_size INTEGER,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      console.log("Datenbank-Check: Tabelle 'documents' ist bereit.");

      const projectsInfo = await all<{ name: string }>("PRAGMA table_info(projects)");
      const existingProjectsCols = projectsInfo.map(c => c.name);
      
      if (existingProjectsCols.length > 0 && !existingProjectsCols.includes('client_id')) {
        await run(`ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL`);
        console.log("Datenbank-Check: Spalte 'client_id' wurde erfolgreich zu 'projects' hinzugefügt.");
      }

      const columnsToAddInvoices = [
        { name: 'offer_id', type: 'TEXT' },
        { name: 'client_id', type: 'TEXT' },
        { name: 'client_company', type: 'TEXT' },
        { name: 'client_address', type: 'TEXT' },
        { name: 'client_email', type: 'TEXT' },
        { name: 'positions_json', type: 'TEXT' },
        { name: 'subtotal_cents', type: 'INTEGER DEFAULT 0' },
        { name: 'tax_rate_pct', type: 'REAL DEFAULT 19' },
        { name: 'tax_amount_cents', type: 'INTEGER DEFAULT 0' },
        { name: 'total_cents', type: 'INTEGER DEFAULT 0' },
        { name: 'cancelled_at', type: 'TEXT' },
        { name: 'cancel_reason', type: 'TEXT' },
        { name: 'original_invoice_id', type: 'TEXT' },
        { name: 'avv_accepted', type: 'INTEGER DEFAULT 0' },
        { name: 'avv_accepted_at', type: 'TEXT' }
      ];

      const invoicesInfo = await all<{ name: string }>("PRAGMA table_info(invoices)");
      const existingInvoicesCols = invoicesInfo.map(c => c.name);

      for (const col of columnsToAddInvoices) {
        if (!existingInvoicesCols.includes(col.name)) {
          await run(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.type}`);
          console.log(`Datenbank-Check: Spalte '${col.name}' wurde erfolgreich zu 'invoices' hinzugefügt.`);
        }
      }
      console.log("Datenbank-Check: Alle Tabellen und Spalten sind vollständig und auf dem neuesten Stand!");

    } catch (err) {
      console.error("Fehler bei der automatischen Datenbank-Aktualisierung:", err);
    }
  })();
}