const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { startSyncLoop } = require('./sync.cjs');
// App-ID setzen — MUSS vor app.whenReady() stehen
app.setAppUserModelId('com.fundament-studio.studio-os-v2');

const isDev = !app.isPackaged;
let mainWindow = null;
let db = null;

function getDbPath() {
  const userData = app.getPath('userData');
  const dbName = isDev ? 'studio-os-v2-dev.db' : 'studio-os-v2.db';
  return path.join(userData, dbName);
}

function getSchemaPath() {
  return path.join(__dirname, 'schema.sql');
}

/**
 * Liest schema.sql und führt es aus. Muss idempotent sein
 * (CREATE TABLE IF NOT EXISTS etc. in schema.sql vorausgesetzt),
 * damit es sowohl bei einer frischen/leeren DB als auch bei einer
 * bereits existierenden DB gefahrlos laufen kann.
 */
function reconcileSchemaColumns(database, schemaPath) {
  let schema = fs.readFileSync(schemaPath, 'utf8');

  // SQL-Kommentare (--) entfernen, bevor der Text analysiert wird
  schema = schema.split('\n').map(line => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');

  // Alle CREATE TABLE-Blöcke aus schema.sql extrahieren
  const tableRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/gi;
  let match;

  while ((match = tableRe.exec(schema)) !== null) {
    const tableName = match[1];
    const body = match[2];

    // Existiert die Tabelle überhaupt in der DB? Wenn nicht: überspringen.
    const tableExists = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName);
    if (!tableExists) continue;

    const existingCols = new Set(
      database.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name)
    );

    // Spaltenzeilen grob parsen
    const columnDefs = splitTopLevelCommas(body);

    for (const rawDef of columnDefs) {
      const def = rawDef.trim();
      if (!def) continue;

      const colMatch = def.match(/^(\w+)\s+(.*)$/s);
      if (!colMatch) continue;
      const colName = colMatch[1];
      if (['UNIQUE', 'PRIMARY', 'FOREIGN', 'CHECK', 'CONSTRAINT'].includes(colName.toUpperCase())) {
        continue;
      }
      if (existingCols.has(colName)) continue;

      let colDef = colMatch[2].trim().replace(/,$/, '');

      // NOT NULL ohne DEFAULT auf einer potenziell nicht-leeren Tabelle abfangen
      const hasDefault = /\bDEFAULT\b/i.test(colDef);
      const hasNotNull = /\bNOT\s+NULL\b/i.test(colDef);
      if (hasNotNull && !hasDefault) {
        const isIntegerType = /\b(INTEGER|REAL)\b/i.test(colDef);
        colDef = colDef.replace(/\bNOT\s+NULL\b/i, `NOT NULL DEFAULT ${isIntegerType ? '0' : "''"}`);
      }

      const stmt = `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`;
      try {
        database.exec(stmt);
        console.warn('[SCHEMA REPAIR] Spalte nachgetragen:', tableName + '.' + colName);
      } catch (e) {
        const msg = String(e.message);

        if (msg.includes('non-constant default')) {
          const defaultMatch = colDef.match(/DEFAULT\s+(\(.*\)|\S+)/i);
          const typeOnlyMatch = colDef.match(/^(\S+)/);
          const baseType = typeOnlyMatch ? typeOnlyMatch[1] : 'TEXT';

          if (defaultMatch) {
            const defaultExpr = defaultMatch[1];
            try {
              database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${baseType}`);
              database.exec(`UPDATE ${tableName} SET ${colName} = ${defaultExpr} WHERE ${colName} IS NULL`);
              console.warn(
                '[SCHEMA REPAIR] Spalte nachgetragen (Fallback):',
                tableName + '.' + colName
              );
            } catch (fallbackErr) {
              console.error('[SCHEMA REPAIR FEHLER, Fallback gescheitert]', stmt, '->', fallbackErr.message);
            }
            continue;
          }
        }
        console.error('[SCHEMA REPAIR FEHLER]', stmt, '->', msg);
      }
    }
  }
}

/** Teilt einen Klammerinhalt an Kommas auf Klammertiefe 0 */
function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0;

  const lines = sql.split('\n').map(line => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  });
  const cleaned = lines.join('\n');

  const tokenRe = /\bBEGIN\b|\bEND\b|;/gi;
  let lastIndex = 0;
  let match;

  while ((match = tokenRe.exec(cleaned)) !== null) {
    const token = match[0].toUpperCase();
    current += cleaned.slice(lastIndex, match.index + match[0].length);
    lastIndex = match.index + match[0].length;

    if (token === 'BEGIN') {
      depth++;
    } else if (token === 'END') {
      depth = Math.max(0, depth - 1);
    } else if (token === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    }
  }

  current += cleaned.slice(lastIndex);
  if (current.trim()) statements.push(current.trim());

  return statements;
}

function applyBaseSchema(database) {
  const schemaPath = getSchemaPath();
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`schema.sql nicht gefunden unter: ${schemaPath}`);
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const statements = splitSqlStatements(schema).filter(stmt => {
    const isMigrationBookkeeping = /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+schema_migrations/i.test(stmt);
    if (isMigrationBookkeeping) {
      console.warn('[SCHEMA] Ignoriere schema.sql-eigene Migrations-Markierung:', stmt.slice(0, 80).replace(/\s+/g, ' '));
    }
    return !isMigrationBookkeeping;
  });

  for (const stmt of statements) {
    try {
      database.exec(stmt + ';');
    } catch (e) {
      const msg = String(e.message);
      const tolerable =
        msg.includes('duplicate column') ||
        msg.includes('already exists') ||
        msg.includes('no such column') ||
        msg.includes('no such table');

      if (!tolerable) throw e;

      console.warn(
        '[SCHEMA WARNUNG] Statement übersprungen (Schema-Drift):\n',
        stmt.slice(0, 120).replace(/\s+/g, ' '),
        '\n  Grund:', msg
      );
    }
  }
}

function openDatabase() {
  const dbPath = getDbPath();
  console.log('>>> Öffne Datenbank unter:', dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Spaltennachrüstung: suppliers -> cancel_intended
  try {
    db.exec("ALTER TABLE suppliers ADD COLUMN cancel_intended INTEGER NOT NULL DEFAULT 0;");
    console.warn('[DATENBANK] Spalte cancel_intended erfolgreich nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler beim Prüfen der cancel_intended Spalte:', e.message);
    }
  }

  // Spaltennachrüstung: project_phases -> planned_week_key
  try {
    db.exec("ALTER TABLE project_phases ADD COLUMN planned_week_key TEXT;");
    console.warn('[DATENBANK] Spalte planned_week_key erfolgreich für Modulphasen nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei planned_week_key Spalte:', e.message);
    }
  }

  // Spaltennachrüstung: project_phases -> planned_month_key (FÜR DEN SYNC BENÖTIGT)
  try {
    db.exec("ALTER TABLE project_phases ADD COLUMN planned_month_key TEXT;");
    console.warn('[DATENBANK] Spalte planned_month_key erfolgreich für Modulphasen nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei planned_month_key Spalte:', e.message);
    }
  }

  // Spaltennachrüstung: social_posts -> content_pillar
  try {
    db.exec("ALTER TABLE social_posts ADD COLUMN content_pillar TEXT;");
    console.warn('[DATENBANK] Spalte content_pillar erfolgreich für social_posts nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei content_pillar Spalte:', e.message);
    }
  }

  // Spaltennachrüstung: project_price_calcs -> project_id
  try {
    db.exec("ALTER TABLE project_price_calcs ADD COLUMN project_id TEXT;");
    console.warn('[DATENBANK] Spalte project_id erfolgreich für project_price_calcs nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei project_id Spalte in project_price_calcs:', e.message);
    }
  }

  // Spaltennachrüstung: todos -> category
  try {
    db.exec("ALTER TABLE todos ADD COLUMN category TEXT;");
    console.warn('[DATENBANK] Spalte category erfolgreich für todos nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei category Spalte in todos:', e.message);
    }
  }

  // Spaltennachrüstung: todos -> sprint_id
  try {
    db.exec("ALTER TABLE todos ADD COLUMN sprint_id TEXT;");
    console.warn('[DATENBANK] Spalte sprint_id erfolgreich für todos nachgerüstet!');
  } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('[DATENBANK FEHLER] Fehler bei sprint_id Spalte in todos:', e.message);
    }
  }
  // --- In electron/main.cjs innerhalb von openDatabase() hinzufügen ---

// Kitchen.co Integration: Spalten für Projekte nachrüsten
try {
  db.exec("ALTER TABLE projects ADD COLUMN kitchen_folder_id TEXT;");
  db.exec("ALTER TABLE projects ADD COLUMN kitchen_board_id TEXT;");
  console.warn('[KITCHEN] Spalten für Projekte nachgerüstet');
} catch (e) { /* Spalten existieren wahrscheinlich schon */ }

// Kitchen.co Integration: Spalten für Phasen (Tasks) nachrüsten
try {
  db.exec("ALTER TABLE project_phases ADD COLUMN kitchen_task_id TEXT;");
  console.warn('[KITCHEN] Spalten für Phasen nachgerüstet');
} catch (e) { }

// Kitchen.co Integration: Spalten für Dokumente/Assets nachrüsten
try {
  db.exec("ALTER TABLE project_assets ADD COLUMN kitchen_file_id TEXT;");
  console.warn('[KITCHEN] Spalten für Assets nachgerüstet');
} catch (e) { }
  applyBaseSchema(db);
  reconcileSchemaColumns(db, getSchemaPath());
  applyBaseSchema(db);

  runMigrations(db);
  seedIfEmpty(db);

  return db;
}

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const migrations = [
    {
      version: 2,
      up: [
        'ALTER TABLE projects ADD COLUMN client_company TEXT',
        'ALTER TABLE projects ADD COLUMN client_email TEXT',
        'ALTER TABLE projects ADD COLUMN client_phone TEXT',
        'ALTER TABLE projects ADD COLUMN client_address TEXT',
        'ALTER TABLE project_assets ADD COLUMN file_name TEXT',
        'ALTER TABLE project_assets ADD COLUMN file_mime TEXT',
        'ALTER TABLE project_assets ADD COLUMN file_size INTEGER',
      ],
    },
    {
      version: 3,
      up: [
        `CREATE TABLE IF NOT EXISTS clients (
          id                  TEXT PRIMARY KEY,
          name                TEXT NOT NULL,
          company             TEXT,
          email               TEXT,
          phone               TEXT,
          address             TEXT,
          tax_id              TEXT,
          onboarding_status   TEXT NOT NULL DEFAULT 'new',
          notes               TEXT,
          created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)',
        'CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(onboarding_status)',

        `CREATE TABLE IF NOT EXISTS client_onboarding_items (
          id              TEXT PRIMARY KEY,
          client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          label           TEXT NOT NULL,
          is_checked      INTEGER NOT NULL DEFAULT 0,
          checked_at      TEXT,
          position        INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_client_onboarding_items_client ON client_onboarding_items(client_id, position)',

        `CREATE TABLE IF NOT EXISTS leads (
          id                      TEXT PRIMARY KEY,
          client_name             TEXT NOT NULL,
          client_email            TEXT,
          source                  TEXT,
          title                   TEXT NOT NULL,
          description             TEXT,
          estimated_value_cents   INTEGER,
          status                  TEXT NOT NULL DEFAULT 'new',
          received_date           TEXT NOT NULL,
          notes                   TEXT,
          created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)',
        'CREATE INDEX IF NOT EXISTS idx_leads_received ON leads(received_date)',

        `CREATE TABLE IF NOT EXISTS contracts (
          id                      TEXT PRIMARY KEY,
          client_id               TEXT REFERENCES clients(id) ON DELETE SET NULL,
          project_id              TEXT REFERENCES projects(id) ON DELETE SET NULL,
          title                   TEXT NOT NULL,
          type                    TEXT,
          start_date              TEXT NOT NULL,
          end_date                TEXT,
          notice_period_days      INTEGER NOT NULL DEFAULT 0,
          monthly_amount_cents    INTEGER NOT NULL DEFAULT 0,
          billing_cycle           TEXT NOT NULL DEFAULT 'monthly',
          status                  TEXT NOT NULL DEFAULT 'active',
          notes                   TEXT,
          created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id)',
        'CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)',
        'CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date)',

        `CREATE TABLE IF NOT EXISTS suppliers (
          id                      TEXT PRIMARY KEY,
          name                    TEXT NOT NULL,
          category                TEXT,
          monthly_cost_cents      INTEGER NOT NULL DEFAULT 0,
          billing_cycle           TEXT NOT NULL DEFAULT 'monthly',
          notice_period_days      INTEGER NOT NULL DEFAULT 0,
          contract_end_date       TEXT,
          url                     TEXT,
          notes                   TEXT,
          active                  INTEGER NOT NULL DEFAULT 1,
          created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active)',
        'CREATE INDEX IF NOT EXISTS idx_suppliers_end_date ON suppliers(contract_end_date)',

        `CREATE TABLE IF NOT EXISTS notes (
          id              TEXT PRIMARY KEY,
          title           TEXT NOT NULL,
          content         TEXT,
          category        TEXT,
          tags            TEXT,
          pinned          INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)',
        'CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned)',

        `CREATE TABLE IF NOT EXISTS recurring_transactions (
          id              TEXT PRIMARY KEY,
          type            TEXT NOT NULL,
          amount_cents    INTEGER NOT NULL,
          currency        TEXT NOT NULL DEFAULT 'EUR',
          description     TEXT NOT NULL,
          category        TEXT,
          project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
          frequency       TEXT NOT NULL DEFAULT 'monthly',
          next_date       TEXT NOT NULL,
          active          INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_recurring_transactions_next ON recurring_transactions(next_date)',
        'CREATE INDEX IF NOT EXISTS idx_recurring_transactions_active ON recurring_transactions(active)',

        `CREATE TABLE IF NOT EXISTS social_post_metrics (
          id                  TEXT PRIMARY KEY,
          post_id             TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
          snapshot_date       TEXT NOT NULL,
          impressions         INTEGER,
          reach               INTEGER,
          likes               INTEGER,
          comments            INTEGER,
          shares              INTEGER,
          saves               INTEGER,
          clicks              INTEGER,
          profile_visits      INTEGER,
          notes               TEXT,
          created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )`,
        'CREATE INDEX IF NOT EXISTS idx_social_post_metrics_post ON social_post_metrics(post_id, snapshot_date)',

        'ALTER TABLE transactions ADD COLUMN reference_type TEXT',
        'ALTER TABLE transactions ADD COLUMN reference_id TEXT',
        'ALTER TABLE transactions ADD COLUMN recurring_id TEXT REFERENCES recurring_transactions(id) ON DELETE SET NULL',
        'ALTER TABLE transactions ADD COLUMN tax_rate_pct REAL',
        'ALTER TABLE transactions ADD COLUMN net_amount_cents INTEGER',
        'ALTER TABLE transactions ADD COLUMN tax_amount_cents INTEGER',
        'CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_type, reference_id)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_recurring ON transactions(recurring_id)',

        'ALTER TABLE invoices ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL',
        'CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)',

        'ALTER TABLE offers ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL',
        'CREATE INDEX IF NOT EXISTS idx_offers_client ON offers(client_id)',
      ],
    },
    {
      version: 4,
      up: [
        'ALTER TABLE recurring_transactions ADD COLUMN supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL',
        'CREATE INDEX IF NOT EXISTS idx_recurring_transactions_supplier ON recurring_transactions(supplier_id)',
      ],
    },
    {
      version: 5,
      up: [
        'ALTER TABLE recurring_transactions ADD COLUMN last_generated TEXT',
      ],
    },
    {
      version: 7,
      up: [
        'ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL',
        'CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id)',
      ],
    },
    {
      version: 8,
      up: [
        'ALTER TABLE project_phases ADD COLUMN estimated_hours REAL',
      ],
    },
    {
      version: 9,
      up: [
        'ALTER TABLE invoices ADD COLUMN offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL',
        'ALTER TABLE invoices ADD COLUMN client_company TEXT',
        'ALTER TABLE invoices ADD COLUMN client_address TEXT',
        'ALTER TABLE invoices ADD COLUMN client_email TEXT',
        "ALTER TABLE invoices ADD COLUMN positions_json TEXT NOT NULL DEFAULT '[]'",
        'ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE invoices ADD COLUMN tax_rate_pct REAL NOT NULL DEFAULT 19',
        'ALTER TABLE invoices ADD COLUMN tax_amount_cents INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE invoices ADD COLUMN total_cents INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE invoices ADD COLUMN cancelled_at TEXT',
        'ALTER TABLE invoices ADD COLUMN cancel_reason TEXT',
        'ALTER TABLE invoices ADD COLUMN original_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL',
        'ALTER TABLE invoices ADD COLUMN avv_accepted INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE invoices ADD COLUMN avv_accepted_at TEXT',
        'CREATE INDEX IF NOT EXISTS idx_invoices_offer ON invoices(offer_id)',
      ],
    },
    {
      version: 10,
      up: [
        'ALTER TABLE suppliers ADD COLUMN cancel_intended INTEGER NOT NULL DEFAULT 0',
      ],
    }
  ];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    for (const stmt of m.up) {
      try { database.exec(stmt); } catch (e) {
        const msg = String(e.message);
        if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw e;
      }
    }
    database.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(m.version);
  }
}

function seedIfEmpty(database) {
  const count = database.prepare('SELECT COUNT(*) AS c FROM phase_templates').get().c;
  if (count > 0) return;

  const id = () => crypto.randomUUID();
  const tpl = database.prepare('INSERT INTO phase_templates (id, name, description, is_system) VALUES (?, ?, ?, 1)');
  const item = database.prepare('INSERT INTO phase_template_items (id, template_id, name, description, position) VALUES (?, ?, ?, ?, ?)');
  const chk = database.prepare('INSERT INTO checklist_template_items (id, phase_template_item_id, label, position) VALUES (?, ?, ?, ?)');

  const templateId = id();
  tpl.run(templateId, 'Standard Website-Projekt', 'Klassische Phasen für eine Website');

  const phases = [
    { name: 'Discovery', desc: 'Briefing, Recherche, Ziele', checks: ['Kick-off Call', 'Briefing-Dokument', 'Ziele definieren'] },
    { name: 'Konzept', desc: 'Sitemap, Moodboard, Struktur', checks: ['Sitemap', 'Moodboard', 'Struktur-Freigabe'] },
    { name: 'Design', desc: 'UI, Komponenten, Freigabe', checks: ['Moodboard erstellt', 'Farbpalette + Typografie', 'Desktop-Wireframes', 'Mobile-Wireframes', 'UI-Design Startseite', 'UI-Design Unterseiten', 'Freigabe Kundin einholen'] },
    { name: 'Entwicklung', desc: 'CMS, Inhalte, Testing', checks: ['Setup', 'Inhalte pflegen', 'Testing', 'Abnahme'] },
    { name: 'Launch', desc: 'Go-Live, Übergabe, Doku', checks: ['Go-Live', 'Übergabe', 'Doku'] },
  ];

  phases.forEach((p, i) => {
    const phaseId = id();
    item.run(phaseId, templateId, p.name, p.desc, i);
    p.checks.forEach((label, j) => chk.run(id(), phaseId, label, j));
  });
}

function requireDb() {
  if (!db) {
    throw new Error('Datenbank ist nicht initialisiert (db ist null). App ggf. neu starten.');
  }
  return db;
}

function registerIpc() {
  ipcMain.handle('db:all', (_evt, sql, params = []) => {
    return requireDb().prepare(sql).all(...params);
  });

  ipcMain.handle('db:get', (_evt, sql, params = []) => {
    return requireDb().prepare(sql).get(...params);
  });

  ipcMain.handle('db:run', (_evt, sql, params = []) => {
    const info = requireDb().prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  });

  ipcMain.handle('db:transaction', (_evt, statements) => {
    const database = requireDb();
    const txFn = database.transaction((rows) => {
      const results = [];
      for (const row of rows) {
        const info = database.prepare(row.sql).run(...(row.params || []));
        results.push({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
      }
      return results;
    });
    return txFn(statements);
  });

  ipcMain.handle('util:uuid', () => crypto.randomUUID());

  ipcMain.handle('db:backup', async () => {
    const database = requireDb();
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Backup speichern',
      defaultPath: `studio-os-v2-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' };
    await database.backup(res.filePath);
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('db:restore', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Backup auswählen',
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, reason: 'canceled' };

    const sourcePath = res.filePaths[0];
    const targetPath = getDbPath();

    try {
      if (db) {
        db.close();
        db = null;
      }
      fs.copyFileSync(sourcePath, targetPath);
      for (const ext of ['-wal', '-shm']) {
        const p = targetPath + ext;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      openDatabase();
      return { ok: true };
    } catch (e) {
      try { openDatabase(); } catch (err) { /* best effort */ }
      return { ok: false, reason: String(e.message || e) };
    }
  });

  ipcMain.handle('db:reset', async () => {
    const database = requireDb();
    try {
      database.exec('PRAGMA foreign_keys = OFF;');

      database.exec('DROP TABLE IF EXISTS project_phases;');
      database.exec('DROP TABLE IF EXISTS project_checklist_items;');
      database.exec('DROP TABLE IF EXISTS project_assets;');
      database.exec('DROP TABLE IF EXISTS todos;');
      database.exec('DROP TABLE IF EXISTS social_post_assets;');
      database.exec('DROP TABLE IF EXISTS social_post_time_entries;');
      database.exec('DROP TABLE IF EXISTS social_post_metrics;');
      database.exec('DROP TABLE IF EXISTS social_posts;');
      database.exec('DROP TABLE IF EXISTS client_onboarding_items;');
      database.exec('DROP TABLE IF EXISTS time_entries;');
      database.exec('DROP TABLE IF EXISTS transactions;');
      database.exec('DROP TABLE IF EXISTS invoices;');
      database.exec('DROP TABLE IF EXISTS offers;');
      database.exec('DROP TABLE IF EXISTS recurring_transactions;');
      database.exec('DROP TABLE IF EXISTS contracts;');
      database.exec('DROP TABLE IF EXISTS leads;');
      database.exec('DROP TABLE IF EXISTS clients;');
      database.exec('DROP TABLE IF EXISTS suppliers;');
      database.exec('DROP TABLE IF EXISTS notes;');
      database.exec('DROP TABLE IF EXISTS phase_template_items;');
      database.exec('DROP TABLE IF EXISTS checklist_template_items;');
      database.exec('DROP TABLE IF EXISTS phase_templates;');
      database.exec('DROP TABLE IF EXISTS projects;');
      database.exec('DROP TABLE IF EXISTS hourly_rate_calculations;');
      database.exec('DROP TABLE IF EXISTS annual_goals;');
      database.exec('DROP TABLE IF EXISTS goals;');
      database.exec('DROP TABLE IF EXISTS project_price_calcs;');
      database.exec('DROP TABLE IF EXISTS app_settings;');
      database.exec('DROP TABLE IF EXISTS schema_migrations;');

      // Nutzt jetzt dieselbe Reihenfolge wie openDatabase()
      applyBaseSchema(database);
      reconcileSchemaColumns(database, getSchemaPath());
      applyBaseSchema(database);

      runMigrations(database);
      seedIfEmpty(database);

      database.exec('PRAGMA foreign_keys = ON;');

      return { ok: true };
    } catch (e) {
      console.error('db:reset failed:', e);
      return { ok: false, reason: String(e.message || e) };
    }
  });

  ipcMain.handle('file:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Datei auswählen',
      properties: ['openFile'],
      filters: [
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    });

    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false, reason: 'canceled' };
    }

    const filePath = res.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const name = path.basename(filePath);

    const mimeByExt = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'csv': 'text/csv',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
    };

    const mime = mimeByExt[ext] || 'application/octet-stream';

    return {
      ok: true,
      name,
      mime,
      ext,
      size_bytes: stat.size,
      data_base64: buffer.toString('base64'),
    };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#FAFAF7',
    title: 'Studio OS v2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => { mainWindow = null; });
}

let syncInterval = null;

app.whenReady().then(() => {
  try {
    openDatabase();
  } catch (e) {
    console.error('>>> FATAL: Datenbank-Initialisierung fehlgeschlagen:', e);
    dialog.showErrorBox(
      'Datenbankfehler',
      `Die Datenbank konnte nicht initialisiert werden:\n\n${e.message}\n\nBitte prüfe, ob schema.sql vorhanden ist.`
    );
    app.quit();
    return;
  }

  registerIpc();
  createWindow();

  // NEU: Liest die echte Wochenkapazität direkt aus app_settings (dieselbe
  // Tabelle/Spalten wie das settings-Objekt in src/lib/db.ts:
  // get: key/value aus app_settings). Vorher fehlte dieser Parameter komplett
  // an startSyncLoop -> sync.cjs nutzte IMMER den Fallback-Wert 40 statt der
  // echten, eingestellten Kapazität (20).
  const getWeeklyCapacity = () => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('weekly_capacity_hours');
      const parsed = row ? parseFloat(row.value) : NaN;
      return isNaN(parsed) ? 40 : parsed;
    } catch (e) {
      console.error('[Sync] Konnte weekly_capacity_hours nicht lesen:', e.message);
      return 40;
    }
  };

  syncInterval = startSyncLoop(() => db, 30000, mainWindow, getWeeklyCapacity);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (syncInterval) clearInterval(syncInterval);

  if (db) {
    try { db.close(); } catch (e) { console.error('DB close failed:', e); }
    db = null;
  }
});
