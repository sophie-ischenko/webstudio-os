-- ============================================================
-- STUDIO OS — SQLite Schema
-- Single-User, lokal, kein Cloud-Sync, keine Mandantentrennung
-- IDs: TEXT (UUID v4), Geld: INTEGER (Cent), Zeit: TEXT (ISO 8601)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- MODUL 1 · PROJEKTMANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS phase_templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    is_system       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS phase_template_items (
    id              TEXT PRIMARY KEY,
    template_id     TEXT NOT NULL REFERENCES phase_templates(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    position        INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_phase_template_items_template ON phase_template_items(template_id, position);

CREATE TABLE IF NOT EXISTS checklist_template_items (
    id                      TEXT PRIMARY KEY,
    phase_template_item_id  TEXT NOT NULL REFERENCES phase_template_items(id) ON DELETE CASCADE,
    label                   TEXT NOT NULL,
    position                INTEGER NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_checklist_template_items_phase ON checklist_template_items(phase_template_item_id, position);

CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    client_name     TEXT,
    client_company  TEXT,
    client_email    TEXT,
    client_phone    TEXT,
    client_address  TEXT,
    template_id     TEXT REFERENCES phase_templates(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    start_date      TEXT,
    target_end_date TEXT,
    actual_end_date TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_template ON projects(template_id);

CREATE TABLE IF NOT EXISTS project_phases (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_template_item_id  TEXT REFERENCES phase_template_items(id) ON DELETE SET NULL,
    name_override           TEXT,
    status                  TEXT NOT NULL DEFAULT 'open',
    deadline                TEXT,
    completed_at            TEXT,
    position_override       INTEGER,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_phases_template_item ON project_phases(phase_template_item_id);
CREATE INDEX IF NOT EXISTS idx_project_phases_deadline ON project_phases(deadline);

CREATE TABLE IF NOT EXISTS project_checklist_items (
    id                          TEXT PRIMARY KEY,
    project_phase_id            TEXT NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
    checklist_template_item_id  TEXT REFERENCES checklist_template_items(id) ON DELETE SET NULL,
    label_override              TEXT,
    is_checked                  INTEGER NOT NULL DEFAULT 0,
    checked_at                  TEXT,
    position_override           INTEGER,
    created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_project_checklist_items_phase ON project_checklist_items(project_phase_id);

CREATE TABLE IF NOT EXISTS project_assets (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_phase_id TEXT REFERENCES project_phases(id) ON DELETE SET NULL,
    type            TEXT NOT NULL,         -- 'link' | 'note' | 'file'
    label           TEXT NOT NULL,
    value           TEXT NOT NULL,         -- URL, Text, oder Base64-Daten
    file_name       TEXT,
    file_mime       TEXT,
    file_size       INTEGER,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_project_assets_project ON project_assets(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assets_phase ON project_assets(project_phase_id);

-- ============================================================
-- MODUL 2 · FINANZEN
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_transactions (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    description     TEXT NOT NULL,
    category        TEXT,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    frequency       TEXT NOT NULL,         -- 'weekly' | 'monthly' | 'quarterly' | 'yearly'
    next_date       TEXT NOT NULL,
    last_generated  TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_transactions(active, next_date);

CREATE TABLE IF NOT EXISTS transactions (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    description     TEXT NOT NULL,
    category        TEXT,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    transaction_date TEXT NOT NULL,
    reference_type  TEXT,
    reference_id    TEXT,
    recurring_id    TEXT REFERENCES recurring_transactions(id) ON DELETE SET NULL,
    -- Umsatzsteuer (DE-Kontext)
    tax_rate_pct    REAL,                 -- NULL = nicht steuerrelevant; 0 = Kleinunternehmer; 19 = USt-pflichtig
    net_amount_cents INTEGER,            -- Nettobetrag (ohne USt)
    tax_amount_cents INTEGER,            -- USt-Betrag
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    invoice_number  TEXT,
    client_name     TEXT NOT NULL,
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    status          TEXT NOT NULL DEFAULT 'open',
    issued_date     TEXT NOT NULL,
    due_date        TEXT,
    paid_date       TEXT,
    paid_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

CREATE TABLE IF NOT EXISTS offers (
    id              TEXT PRIMARY KEY,
    client_name     TEXT NOT NULL,
    title           TEXT NOT NULL,
    estimated_value_cents INTEGER,
    probability_pct INTEGER,
    status          TEXT NOT NULL DEFAULT 'draft',
    sent_date       TEXT,
    decision_expected_date TEXT,
    converted_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

CREATE TABLE IF NOT EXISTS hourly_rate_calculations (
    id                          TEXT PRIMARY KEY,
    label                       TEXT,
    desired_annual_income_cents INTEGER NOT NULL,
    business_costs_annual_cents INTEGER NOT NULL,
    billable_hours_per_week    REAL NOT NULL,
    weeks_per_year             REAL NOT NULL DEFAULT 42,
    buffer_pct                 REAL NOT NULL DEFAULT 0,
    result_hourly_rate_cents   INTEGER NOT NULL,
    created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS annual_goals (
    id                      TEXT PRIMARY KEY,
    year                    INTEGER NOT NULL,
    target_revenue_cents    INTEGER,
    target_project_count    INTEGER,
    target_hourly_rate_cents INTEGER,
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(year)
);

-- ============================================================
-- MODUL 3 · SOCIAL MEDIA PLANNER
-- ============================================================

CREATE TABLE IF NOT EXISTS post_templates (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    platform        TEXT NOT NULL,
    format          TEXT NOT NULL,
    caption_template TEXT,
    default_checklist TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS social_posts (
    id              TEXT PRIMARY KEY,
    template_id     TEXT REFERENCES post_templates(id) ON DELETE SET NULL,
    platform        TEXT NOT NULL,
    format          TEXT NOT NULL,
    topic           TEXT,
    caption         TEXT,
    status          TEXT NOT NULL DEFAULT 'idea',
    scheduled_date  TEXT,
    published_date  TEXT,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_social_posts_template ON social_posts(template_id);

CREATE TABLE IF NOT EXISTS social_post_assets (
    id              TEXT PRIMARY KEY,
    post_id         TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    label           TEXT NOT NULL,
    value           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_social_post_assets_post ON social_post_assets(post_id);

CREATE TABLE IF NOT EXISTS social_post_time_entries (
    id              TEXT PRIMARY KEY,
    post_id         TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    minutes         INTEGER NOT NULL,
    entry_date      TEXT NOT NULL,
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_social_post_time_entries_post ON social_post_time_entries(post_id);
CREATE INDEX IF NOT EXISTS idx_social_post_time_entries_date ON social_post_time_entries(entry_date);

CREATE TABLE IF NOT EXISTS social_post_metrics (
    id              TEXT PRIMARY KEY,
    post_id         TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    snapshot_date   TEXT NOT NULL,
    -- Manuell eintragbare Kennzahlen (je nach Plattform unterschiedlich relevant)
    impressions     INTEGER NOT NULL DEFAULT 0,
    reach           INTEGER NOT NULL DEFAULT 0,
    likes            INTEGER NOT NULL DEFAULT 0,
    comments        INTEGER NOT NULL DEFAULT 0,
    shares          INTEGER NOT NULL DEFAULT 0,
    saves           INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    -- Optional: Profilbesuche oder Follower-Zuwachs durch diesen Post
    profile_visits  INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_post ON social_post_metrics(post_id);
CREATE INDEX IF NOT EXISTS idx_metrics_snapshot ON social_post_metrics(snapshot_date);

-- ============================================================
-- ÜBERGREIFEND: TIME TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS time_entries (
    id              TEXT PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    minutes         INTEGER NOT NULL,
    entry_date      TEXT NOT NULL,
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_entity ON time_entries(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(entry_date);

-- ============================================================
-- PROJEKTPREIS-KALKULATOR
-- ============================================================

CREATE TABLE IF NOT EXISTS project_price_calcs (
    id                      TEXT PRIMARY KEY,
    label                   TEXT,
    client_name             TEXT,
    -- Positionen als JSON-Array: [{name, hours, hourly_rate_cents, type}]
    positions_json         TEXT NOT NULL DEFAULT '[]',
    -- Zusätzliche Kosten (Hosting, Lizenzen, etc.) als JSON: [{label, amount_cents}]
    extra_costs_json       TEXT NOT NULL DEFAULT '[]',
    discount_cents         INTEGER NOT NULL DEFAULT 0,
    buffer_pct             REAL NOT NULL DEFAULT 0,
    -- Ergebnis (zwischengespeichert für Historie)
    subtotal_cents         INTEGER NOT NULL DEFAULT 0,
    total_cents            INTEGER NOT NULL DEFAULT 0,
    total_hours            REAL NOT NULL DEFAULT 0,
    notes                   TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- ZIELPLANER (Wochen-, Monats-, Quartalsziele)
-- ============================================================

CREATE TABLE IF NOT EXISTS goals (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    period_type     TEXT NOT NULL,        -- 'week' | 'month' | 'quarter' | 'year'
    period_key      TEXT NOT NULL,        -- z.B. '2026-W27', '2026-07', '2026-Q3', '2026'
    target_value    REAL,                 -- numerisches Ziel (optional)
    current_value   REAL NOT NULL DEFAULT 0,
    unit            TEXT,                 -- z.B. '€', 'Stunden', 'Projekte', 'Posts'
    category        TEXT,                 -- z.B. 'revenue', 'time', 'projects', 'social', 'personal'
    notes           TEXT,
    is_completed    INTEGER NOT NULL DEFAULT 0,
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_period ON goals(period_type, period_key);
CREATE INDEX IF NOT EXISTS idx_goals_completed ON goals(is_completed);

-- ============================================================
-- TO-DOs (projektunabhängig, optional verlinkbar)
-- ============================================================

CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_date TEXT,
    week_key TEXT,
    sprintid TEXT REFERENCES sprints(id) ON DELETE SET NULL,
    projectid TEXT REFERENCES projects(id) ON DELETE SET NULL,
    projectphaseid TEXT REFERENCES projectphases(id) ON DELETE SET NULL,
    socialpostid TEXT REFERENCES socialposts(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projectphases (
  id TEXT PRIMARY KEY,
  projectid TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phasetemplateitemid TEXT REFERENCES phasetemplateitems(id) ON DELETE SET NULL,
  nameoverride TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  deadline TEXT,
  completedat TEXT,
  positionoverride INTEGER,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projectchecklistitems (
  id TEXT PRIMARY KEY,
  projectphaseid TEXT NOT NULL REFERENCES projectphases(id) ON DELETE CASCADE,
  checklisttemplateitemid TEXT REFERENCES checklisttemplateitems(id) ON DELETE SET NULL,
  labeloverride TEXT,
  ischecked INTEGER NOT NULL DEFAULT 0,
  checkedat TEXT,
  positionoverride INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',
  sprintid TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projectassets (
  id TEXT PRIMARY KEY,
  projectid TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  projectphaseid TEXT REFERENCES projectphases(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  filename TEXT,
  filemime TEXT,
  filesize INTEGER,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  name TEXT,
  startdate TEXT,
  enddate TEXT,
  isactive INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS phasetemplates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  issystem INTEGER NOT NULL DEFAULT 0,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updatedat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS phasetemplateitems (
  id TEXT PRIMARY KEY,
  templateid TEXT NOT NULL REFERENCES phasetemplates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_phasetemplateitems_template ON phasetemplateitems(templateid, position);

CREATE TABLE IF NOT EXISTS checklisttemplateitems (
  id TEXT PRIMARY KEY,
  phasetemplateitemid TEXT NOT NULL REFERENCES phasetemplateitems(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  createdat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_checklisttemplateitems_phase ON checklisttemplateitems(phasetemplateitemid, position);

CREATE INDEX IF NOT EXISTS idx_todos_week ON todos(week_key, position);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id);
CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_date);

-- ============================================================
-- KUNDEN (eigenes Konzept)
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    company         TEXT,
    email           TEXT,
    phone           TEXT,
    address         TEXT,
    tax_id          TEXT,
    -- Onboarding-Status
    onboarding_status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'active' | 'inactive'
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(onboarding_status);

-- Onboarding-Checkliste pro Kunde (Vertrag, AVV, Zugangsdaten...)
CREATE TABLE IF NOT EXISTS client_onboarding_items (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    is_checked      INTEGER NOT NULL DEFAULT 0,
    checked_at      TEXT,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_client ON client_onboarding_items(client_id, position);

-- ============================================================
-- ANFRAGEN (Leads — Stufe vor dem Angebot)
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
    id              TEXT PRIMARY KEY,
    client_name     TEXT NOT NULL,
    client_email    TEXT,
    source          TEXT,                 -- 'website' | 'referral' | 'social' | 'other'
    title           TEXT NOT NULL,
    description     TEXT,
    estimated_value_cents INTEGER,
    status          TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'qualified' | 'offer_sent' | 'won' | 'lost'
    converted_offer_id TEXT,
    converted_project_id TEXT,
    received_date   TEXT NOT NULL,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- ============================================================
-- VERTRÄGE (wiederkehrend, mit Laufzeit/Kündigung)
-- ============================================================

CREATE TABLE IF NOT EXISTS contracts (
    id              TEXT PRIMARY KEY,
    client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'recurring',  -- 'recurring' | 'one_time'
    start_date      TEXT NOT NULL,
    end_date        TEXT,                 -- NULL = unbefristet
    notice_period_days INTEGER NOT NULL DEFAULT 30,
    monthly_amount_cents INTEGER NOT NULL DEFAULT 0,
    billing_cycle   TEXT NOT NULL DEFAULT 'monthly',   -- 'monthly' | 'quarterly' | 'yearly'
    status          TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'ended' | 'cancelled'
    terminated_at   TEXT,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);

-- ============================================================
-- LIEFERANTEN / TOOL-ABOS
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT,                 -- 'hosting' | 'software' | 'hardware' | 'service'
    monthly_cost_cents INTEGER NOT NULL DEFAULT 0,
    billing_cycle   TEXT NOT NULL DEFAULT 'monthly',   -- 'monthly' | 'yearly' | 'one_time'
    notice_period_days INTEGER NOT NULL DEFAULT 30,
    contract_end_date TEXT,
    url             TEXT,
    notes           TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);

-- ============================================================
-- NOTIZEN / WISSENSBASIS
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    category        TEXT,                 -- 'snippet' | 'standard_answer' | 'knowledge' | 'general'
    tags            TEXT,                 -- komma-separierte Tags
    pinned          INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned);

-- ============================================================
-- SETTINGS / APP-WEITE KONFIGURATION
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

-- ============================================================
-- SCHEMA-VERSIONIERUNG
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version         INTEGER PRIMARY KEY,
    applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);

-- ============================================================
-- AVV (Auftragsverarbeitungsvertrag)
-- ============================================================

CREATE TABLE IF NOT EXISTS avvs (
    id                  TEXT PRIMARY KEY,
    client_id           TEXT REFERENCES clients(id) ON DELETE SET NULL,
    client_name         TEXT NOT NULL,
    client_company      TEXT,
    client_address      TEXT,
    client_email        TEXT,
    title               TEXT NOT NULL,
    description         TEXT,
    data_categories     TEXT NOT NULL,
    data_purpose        TEXT NOT NULL,
    data_retention      TEXT,
    security_measures   TEXT,
    status              TEXT NOT NULL DEFAULT 'draft',
    sent_date           TEXT,
    signed_date         TEXT,
    valid_until         TEXT,
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_avvs_client ON avvs(client_id);
CREATE INDEX IF NOT EXISTS idx_avvs_status ON avvs(status);

-- ============================================================
-- DOKUMENTENARCHIV
-- ============================================================

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
  file_data TEXT,      -- NEU HINZUFÜGEN
  file_mime TEXT,      -- NEU HINZUFÜGEN
  file_size INTEGER,   -- NEU HINZUFÜGEN
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);


-- ============================================================
-- SCHEMA-VERSIONIERUNG
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version         INTEGER PRIMARY KEY,
    applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);


INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (4);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (5);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (6);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (7);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (8);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (9);
