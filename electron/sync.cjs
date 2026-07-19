// sync.cjs
const RELAY_URL = 'https://relay.fundament-studio.de';
const RELAY_TOKEN = 'be0e3b7a77a37875b2d58e9eb7955afe30dffa8bdc7f4f29c48a50b65437d2cc';
// TODO: Token in .env / sicheren Store auslagern statt hardcoded im Quellcode.

function getWorkdaysInMonth(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// NEU: Lokales Datum als YYYY-MM-DD formatieren, OHNE über UTC zu gehen.
// toISOString() konvertiert nach UTC und verschiebt bei UTC+1/+2 den
// Wochenstart auf den Vortag -> das war der Grund für die falsche
// Wochenkapazitäts-Anzeige.
function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function syncWithRelay(db, window, weeklyCapacity) {
  if (!db) return;

  // NEU: weeklyCapacity war vorher komplett undefiniert -> ReferenceError
  // bei jedem Sync-Durchlauf, der den kompletten Sync (Push + Pull + Ack)
  // stillschweigend abgebrochen hat. Jetzt als Parameter reingereicht,
  // mit Fallback-Wert falls mal nichts übergeben wird.
  if (typeof weeklyCapacity !== 'number' || isNaN(weeklyCapacity)) {
    console.warn('[Sync] weeklyCapacity fehlt oder ungültig, verwende Fallback 40');
    weeklyCapacity = 40;
  }

  try {
    console.log('[Sync] Starte Synchronisierung...');

    // =========================================================================
    // 1. DYNAMISCHE ZEIT-ERKENNUNG (Absolut ausfallsicher gegen fehlerhafte Daten)
    // =========================================================================
    const maxDateRow = db.prepare("SELECT MAX(entry_date) as max_date FROM time_entries").get();

    let d0 = new Date(); // Standardmäßig aktuelle Systemzeit
    if (maxDateRow && maxDateRow.max_date) {
      const parsedDate = new Date(maxDateRow.max_date);
      // Nur verwenden, wenn es ein gültiges Datum ist (verhindert RangeError)
      if (!isNaN(parsedDate.getTime())) {
        d0 = parsedDate;
      }
    }
    const d1 = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);

    const limit0 = (weeklyCapacity / 5) * getWorkdaysInMonth(d0);
    const limit1 = (weeklyCapacity / 5) * getWorkdaysInMonth(d1);

    const key0 = getMonthKey(d0);
    const key1 = getMonthKey(d1);

    // 2. ERFASSTE ZEITEN (LIKE Suche in SQLite für den jeweiligen Monat)
    const tracked0 = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date LIKE ?`).get(key0 + '%');
    const tracked1 = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date LIKE ?`).get(key1 + '%');

    // GEFIXT: lokales Datum statt toISOString() (siehe toLocalDateStr oben)
    const weekStartStr = toLocalDateStr(getWeekStart(d0));
    const trackedWeek = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date >= ?`).get(weekStartStr);

    // 3. PHASEN & RESTAUFWAND BERECHNEN
    const phasesData = db.prepare(`
      SELECT pp.id, pp.project_id, p.name as project_name, pp.estimated_hours, pp.planned_month_key, COALESCE(pp.name_override, pti.name, 'Phase') as name
      FROM project_phases pp 
      JOIN projects p ON pp.project_id = p.id
      LEFT JOIN phase_template_items pti ON pp.phase_template_item_id = pti.id
      WHERE pp.status != 'completed' AND pp.estimated_hours > 0
    `).all();

    const plannedPhases = phasesData.map(ph => {
      const logged = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entity_type = 'project_phase' AND entity_id = ?`).get(ph.id);
      const loggedHours = (logged.t || 0) / 60;
      return {
        id: ph.id,
        name: ph.name,
        project_name: ph.project_name,
        planned_month_key: ph.planned_month_key,
        remaining_hours: Math.max(0, ph.estimated_hours - loggedHours)
      };
    });

    const projects = db.prepare(`SELECT id, name FROM projects WHERE status != 'completed'`).all();
    const timerPhases = db.prepare(`SELECT id, project_id, COALESCE(name_override, 'Phase') as name FROM project_phases WHERE status != 'completed'`).all();

    // Mappe normale Projekte
    const mappedProjects = projects.map(p => ({
      id: p.id, name: p.name, color: '#D48166',
      phases: timerPhases.filter(ph => ph.project_id === p.id)
    }));

    // HACK: Wir betten das stats-Objekt als unsichtbares System-Projekt ein!
    const statsDummyProject = {
      id: "system_stats_dummy_id_1337",
      name: "__SYSTEM_STATS__",
      color: "#000000",
      stats: {
        weekly_limit: weeklyCapacity,
        tracked_hours_week: (trackedWeek.t || 0) / 60,
        current_month: {
          key: key0,
          name: d0.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
          tracked_hours: (tracked0.t || 0) / 60,
          limit: limit0
        },
        next_month: {
          key: key1,
          name: d1.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
          tracked_hours: (tracked1.t || 0) / 60,
          limit: limit1
        },
        planned_phases: plannedPhases
      }
    };

    const snapshotPayload = {
      // Sowohl die echten Projekte als auch das Dummy-Projekt hochladen
      projects: [...mappedProjects, statsDummyProject],
      generated_at: new Date().toISOString()
    };

    const pushRes = await fetch(`${RELAY_URL}/api/sync/projects-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
      body: JSON.stringify(snapshotPayload)
    });

    if (pushRes.ok) {
      console.log(`[Sync] Snapshot erfolgreich hochgeladen.`);
    } else {
      // NEU: Fehlerfall wurde vorher komplett verschluckt
      console.error(`[Sync] Snapshot-Upload fehlgeschlagen: ${pushRes.status} ${pushRes.statusText}`);
    }

    // 4. ZEITEN VOM HANDY ABHOLEN
    const pullRes = await fetch(`${RELAY_URL}/api/sync/time-entries/pending`, { headers: { 'Authorization': `Bearer ${RELAY_TOKEN}` } });

    // NEU: Guard gegen fehlerhafte/leere Response, die vorher beim .json() gecrasht ist
    if (!pullRes.ok) {
      console.error(`[Sync] Abruf der Zeiteinträge fehlgeschlagen: ${pullRes.status} ${pullRes.statusText}`);
      return;
    }

    let entries;
    try {
      ({ entries } = await pullRes.json());
    } catch (parseErr) {
      console.error('[Sync] Ungültige JSON-Antwort beim Abruf der Zeiteinträge:', parseErr.message);
      return;
    }

    if (entries && entries.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO time_entries (id, entity_type, entity_id, minutes, entry_date, note, created_at)
        VALUES (@id, @entity_type, @entity_id, @minutes, @entry_date, @note, @created_at)
        ON CONFLICT(id) DO UPDATE SET
          entity_type = excluded.entity_type, entity_id = excluded.entity_id,
          minutes = excluded.minutes, entry_date = excluded.entry_date, note = excluded.note
      `);

      const successfullySavedIds = [];
      db.transaction((rows) => {
        for (const e of rows) {
          try {
            insertStmt.run({
              id: e.id, entity_type: e.entity_type || 'project', entity_id: e.entity_id,
              minutes: e.minutes, entry_date: e.entry_date.split('T')[0], note: e.note || '', created_at: e.created_at || new Date().toISOString()
            });
            successfullySavedIds.push(e.id);
          } catch (err) { console.error(`[Sync] Fehler:`, err.message); }
        }
      })(entries);

      if (successfullySavedIds.length > 0) {
        const ackRes = await fetch(`${RELAY_URL}/api/sync/time-entries/ack`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
          body: JSON.stringify({ ids: successfullySavedIds })
        });
        if (!ackRes.ok) {
          console.error(`[Sync] Ack fehlgeschlagen: ${ackRes.status} ${ackRes.statusText}`);
        }
      }
      if (window && !window.isDestroyed()) window.webContents.send('db:update', { table: 'time_entries' });
    }
  } catch (error) {
    console.error('[Sync Error]', error.message);
  }
}

// NEU: weeklyCapacity wird durchgereicht. getWeeklyCapacityFn ist eine Funktion,
// die den aktuellen Wert liefert (z.B. aus Settings/DB), damit Änderungen
// zur Laufzeit ohne Neustart des Sync-Loops berücksichtigt werden.
function startSyncLoop(getDbFn, intervalMs = 30000, window = null, getWeeklyCapacityFn = () => 40) {
  console.log(`[Sync] Loop aktiv (${intervalMs / 1000}s)`);
  syncWithRelay(getDbFn(), window, getWeeklyCapacityFn());
  return setInterval(() => {
    const db = getDbFn();
    if (db) syncWithRelay(db, window, getWeeklyCapacityFn());
  }, intervalMs);
}

module.exports = { startSyncLoop, syncWithRelay };
