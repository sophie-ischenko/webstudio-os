// Type definitions for Studio OS.
// Mirrors the SQLite tables; money is INTEGER cents, dates are ISO strings.

// ---------------------------------------------------------------------------
// Primitive Types
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type PhaseStatus = 'open' | 'in_progress' | 'done' | 'skipped';
export type TransactionType = 'income' | 'expense';
export type InvoiceStatus = 'open' | 'paid' | 'overdue' | 'cancelled';
export type OfferStatus = 'draft' | 'sent' | 'negotiating' | 'won' | 'lost';
export type PostStatus = 'idea' | 'in_progress' | 'ready' | 'published';
export type EntityType = 'project' | 'project_phase' | 'social_post' | 'other';
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type GoalPeriodType = 'week' | 'month' | 'quarter' | 'year';
export type GoalCategory = 'revenue' | 'time' | 'projects' | 'social' | 'personal';
export type TodoStatus = 'open' | 'in_progress' | 'done';
export type TodoPriority = 'low' | 'normal' | 'high';
export type ClientOnboardingStatus = 'new' | 'active' | 'inactive';
export type LeadStatus = 'new' | 'qualified' | 'offer_sent' | 'won' | 'lost';
export type ContractStatus = 'active' | 'cancelled' | 'ended';
export type AvvStatus = 'draft' | 'sent' | 'signed' | 'cancelled';
export type DocumentType = 'contract' | 'avv' | 'offer' | 'other';
export type DocumentStatus = 'draft' | 'sent' | 'signed' | 'archived' | 'cancelled';
export type DocumentEntityType = 'client' | 'project' | 'general';

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------

export interface PhaseTemplate {
  id: string;
  name: string;
  description: string | null;
  is_system: number;
  created_at: string;
  updated_at: string;
}

export interface PhaseTemplateItem {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
}

export interface ChecklistTemplateItem {
  id: string;
  phase_template_item_id: string;
  label: string;
  position: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Projekte
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  template_id: string | null;
  status: ProjectStatus;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPhase {
  id: string;
  project_id: string;
  phase_template_item_id: string | null;
  name_override: string | null;
  status: PhaseStatus;
  deadline: string | null;
  completed_at: string | null;
  position_override: number | null;
  estimated_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectChecklistItem {
  id: string;
  project_phase_id: string;
  checklist_template_item_id: string | null;
  label_override: string | null;
  is_checked: number;
  checked_at: string | null;
  position_override: number | null;
  created_at: string;
}

export interface ProjectAsset {
  id: string;
  project_id: string;
  project_phase_id: string | null;
  type: 'file' | 'link' | 'note';
  label: string;
  value: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Finanzen
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  type: TransactionType;
  amount_cents: number;
  currency: string;
  description: string;
  category: string | null;
  project_id: string | null;
  transaction_date: string;
  reference_type: string | null;
  reference_id: string | null;
  recurring_id: string | null;
  tax_rate_pct: number | null;
  net_amount_cents: number | null;
  tax_amount_cents: number | null;
  created_at: string;
}

export interface RecurringTransaction {
  id: string;
  type: TransactionType;
  amount_cents: number;
  currency: string;
  description: string;
  category: string | null;
  project_id: string | null;
  frequency: RecurringFrequency;
  next_date: string;
  last_generated: string | null;
  supplier_id: string | null;
  active: number;
  created_at: string;
}

// Rechnungs-Positionen (werden als JSON in invoices.positions_json gespeichert)
export interface InvoicePosition {
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  total_cents: number;
  tax_rate_pct: number;
}

export interface Invoice {
  id: string;
  project_id: string | null;
  offer_id: string | null;
  invoice_number: string;
  client_name: string;
  client_company: string | null;
  client_address: string | null;
  client_email: string | null;
  client_id: string | null;
  positions_json: string;
  subtotal_cents: number;
  tax_rate_pct: number;
  tax_amount_cents: number;
  total_cents: number;
  currency: string;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string | null;
  paid_date: string | null;
  paid_transaction_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  original_invoice_id: string | null;
  avv_accepted: number;
  avv_accepted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Offer {
  id: string;
  client_name: string;
  client_id: string | null;
  title: string;
  estimated_value_cents: number | null;
  probability_pct: number | null;
  status: OfferStatus;
  sent_date: string | null;
  decision_expected_date: string | null;
  converted_project_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HourlyRateCalculation {
  id: string;
  label: string | null;
  desired_annual_income_cents: number;
  business_costs_annual_cents: number;
  billable_hours_per_week: number;
  weeks_per_year: number;
  buffer_pct: number;
  result_hourly_rate_cents: number;
  created_at: string;
}

export interface AnnualGoal {
  id: string;
  year: number;
  target_revenue_cents: number | null;
  target_project_count: number | null;
  target_hourly_rate_cents: number | null;
  notes: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  title: string;
  period_type: GoalPeriodType;
  period_key: string;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  category: GoalCategory | null;
  notes: string | null;
  is_completed: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Projekt-Preiskalkulator
// ---------------------------------------------------------------------------

export interface ProjectPriceCalc {
  id: string;
  label: string | null;
  client_name: string | null;
  positions_json: string;
  extra_costs_json: string;
  discount_cents: number;
  buffer_pct: number;
  subtotal_cents: number;
  total_cents: number;
  total_hours: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricePosition {
  name: string;
  hours: number;
  hourly_rate_cents: number;
  type: 'service' | 'flat';
}

export interface ExtraCost {
  label: string;
  amount_cents: number;
}

// ---------------------------------------------------------------------------
// Social Media
// ---------------------------------------------------------------------------

export interface PostTemplate {
  id: string;
  name: string;
  platform: string;
  format: string;
  caption_template: string | null;
  default_checklist: string | null;
  created_at: string;
}

export interface SocialPost {
  id: string;
  template_id: string | null;
  platform: string;
  format: string;
  topic: string | null;
  caption: string | null;
  status: PostStatus;
  scheduled_date: string | null;
  published_date: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPostAsset {
  id: string;
  post_id: string;
  type: 'file' | 'link' | 'local_path';
  label: string;
  value: string;
  created_at: string;
}

export interface SocialPostTimeEntry {
  id: string;
  post_id: string;
  minutes: number;
  entry_date: string;
  note: string | null;
  created_at: string;
}

export interface SocialPostMetric {
  id: string;
  post_id: string;
  snapshot_date: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  profile_visits: number;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Zeiterfassung
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string;
  entity_type: EntityType;
  entity_id: string | null;
  minutes: number;
  entry_date: string;
  note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  due_date: string | null;
  week_key: string | null;
  project_id: string | null;
  project_phase_id: string | null;
  social_post_id: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Kunden & Onboarding
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  emails: string[];
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  onboarding_status: ClientOnboardingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientOnboardingItem {
  id: string;
  client_id: string;
  label: string;
  is_checked: number;
  checked_at: string | null;
  position: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export interface Lead {
  id: string;
  client_name: string;
  client_email: string | null;
  source: string | null;
  title: string;
  description: string | null;
  estimated_value_cents: number | null;
  status: LeadStatus;
  converted_offer_id: string | null;
  converted_project_id: string | null;
  received_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Verträge
// ---------------------------------------------------------------------------

export interface Contract {
  id: string;
  client_id: string | null;
  project_id: string | null;
  title: string;
  type: 'recurring' | 'one_time';
  start_date: string;
  end_date: string | null;
  notice_period_days: number;
  monthly_amount_cents: number;
  billing_cycle: 'monthly' | 'quarterly' | 'yearly';
  status: ContractStatus;
  terminated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Lieferanten / Tool-Abos
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string;
  category: string | null;
  monthly_cost_cents: number;
  billing_cycle: 'monthly' | 'yearly' | 'one_time';
  notice_period_days: number;
  contract_end_date: string | null;
  url: string | null;
  notes: string | null;
  active: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Notizen
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// AVV (Auftragsverarbeitungsvertrag)
// ---------------------------------------------------------------------------

export type AvvStatus = 'draft' | 'sent' | 'signed' | 'cancelled';

export interface Avv {
  id: string;
  client_id: string | null;
  client_name: string;
  client_company: string | null;
  client_address: string | null;
  client_email: string | null;
  title: string;
  description: string | null;
  data_categories: string;
  data_purpose: string;
  data_retention: string | null;
  security_measures: string | null;
  status: AvvStatus;
  sent_date: string | null;
  signed_date: string | null;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
// ---------------------------------------------------------------------------
// Dokumentenarchiv
// ---------------------------------------------------------------------------

export type DocumentType = 'contract' | 'avv' | 'offer' | 'other';
export type DocumentStatus = 'draft' | 'sent' | 'signed' | 'archived' | 'cancelled';

export interface Document {
  id: string;
  entity_type: 'client' | 'project' | 'general';
  entity_id: string | null;
  entity_name: string | null;
  document_type: DocumentType;
  title: string;
  version: string | null;
  status: DocumentStatus;
  file_name: string | null;
  file_path: string | null;
  file_data: string | null; // NEU
  file_mime: string | null; // NEU
  file_size: number | null; // NEU
  notes: string | null;
  created_at: string;
  updated_at: string;
}
// ---------------------------------------------------------------------------
// App-Settings
// ---------------------------------------------------------------------------

export interface AppSetting {
  key: string;
  value: string;
}