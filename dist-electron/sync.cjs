// sync.cjs
const RELAY_URL =  'https://relay.fundament-studio.de';
const RELAY_TOKEN =  'be0e3b7a77a37875b2d58e9eb7955afe30dffa8bdc7f4f29c48a50b65437d2cc';

/**
 * Hilfsfunktion: Zählt Arbeitstage (Mo-Fr) im aktuellen Monat
 */
function getWorkdaysInMonth(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

/**
 * Hilfsfunktion: Montag 00:00 Uhr der aktuellen Woche (lokal)
 */
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function syncWithRelay(db, window) {
  if (!db) return;

  try {
    console.log('[Sync] Starte Synchronisierung...');

    // =========================================================================
    // 1. KAPAZITÄT & STATS BERECHNEN (Damit Mobile & Desktop matchen)
    // =========================================================================
    
    // A. Monats-Limit berechnen (Arbeitstage * Stunden pro Tag)
    const capRow = db.prepare("SELECT value FROM app_settings WHERE key = 'weekly_capacity_hours'").get();
    const weeklyCapacity = capRow ? parseFloat(capRow.value) : 40;
    const monthlyLimit = (weeklyCapacity / 5) * getWorkdaysInMonth(new Date());

    // A2. Wochenstart (Montag) ermitteln
    const weekStartStr = getWeekStart(new Date()).toISOString().slice(0, 10);

    // B. Erfasste Ist-Stunden für den aktuellen Monat (z.B. die 3.1h)
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().slice(0, 10);
    const tracked = db.prepare(`SELECT SUM(minutes) as total FROM time_entries WHERE entry_date >= ?`).get(monthStartStr);
    const trackedHours = (tracked.total || 0) / 60;

    // B2. Erfasste Ist-Stunden für die aktuelle Woche (Mo-So)
    const trackedWeek = db.prepare(`SELECT SUM(minutes) as total FROM time_entries WHERE entry_date >= ?`).get(weekStartStr);
    const trackedWeekHours = (trackedWeek.total || 0) / 60;

    // C. Geplante Soll-Stunden (Nur Phasen, die NICHT 'completed' sind -> die 16.0h)
    const planned = db.prepare(`
      SELECT SUM(estimated_hours) as total 
      FROM project_phases 
      WHERE status != 'completed'
    `).get();
    const plannedHours = planned.total || 0;

    // =========================================================================
    // 2. SNAPSHOT HOCHLADEN (Desktop -> Server -> Mobile)
    // =========================================================================
    
    const projects = db.prepare(`SELECT id, name FROM projects WHERE status != 'completed'`).all();
    const phases = db.prepare(`
      SELECT pp.id, pp.project_id, pp.estimated_hours, COALESCE(pp.name_override, pti.name, 'Phase') as name
      FROM project_phases pp 
      LEFT JOIN phase_template_items pti ON pp.phase_template_item_id = pti.id
    `).all();

    const snapshotPayload = {
      projects: projects.map(p => ({
        id: p.id, 
        name: p.name, 
        color: '#D48166',
        phases: phases.filter(ph => ph.project_id === p.id).map(ph => ({ 
          id: ph.id, 
          name: ph.name, 
          estimated_hours: ph.estimated_hours || 0 
        }))
      })),
      phases: phases,
      stats: {
        month_name: new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
        monthly_limit: monthlyLimit,
        weekly_limit: weeklyCapacity, 
        tracked_hours: trackedHours,
        tracked_hours_week: trackedWeekHours, 
        planned_hours: plannedHours
      },
      generated_at: new Date().toISOString()
    };

    const pushRes = await fetch(`${RELAY_URL}/api/sync/projects-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
      body: JSON.stringify(snapshotPayload)
    });

    if (pushRes.ok) {
      console.log(`[Sync] Snapshot hochgeladen (Ist Monat: ${trackedHours}h, Ist Woche: ${trackedWeekHours}h, Soll: ${plannedHours}h)`);
    }

    // =========================================================================
    // 3. ZEITEN VOM HANDY ABHOLEN (Mobile -> Server -> Desktop)
    // =========================================================================
    
    const pullRes = await fetch(`${RELAY_URL}/api/sync/time-entries/pending`, {
      headers: { 'Authorization': `Bearer ${RELAY_TOKEN}` }
    });
    const { entries } = await pullRes.json();

    if (entries && entries.length > 0) {
      console.log(`[Sync] ${entries.length} neue Einträge vom Handy gefunden.`);
      
      // FIX: Dynamische Zuordnung von 'entity_type' & nachträgliche Updates via 'DO UPDATE SET' erlauben
      const insertStmt = db.prepare(`
        INSERT INTO time_entries (id, entity_type, entity_id, minutes, entry_date, note, created_at)
        VALUES (@id, @entity_type, @entity_id, @minutes, @entry_date, @note, @created_at)
        ON CONFLICT(id) DO UPDATE SET
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          minutes = excluded.minutes,
          entry_date = excluded.entry_date,
          note = excluded.note
      `);

      const successfullySavedIds = [];
      db.transaction((rows) => {
        for (const e of rows) {
          try {
            insertStmt.run({
              id: e.id,
              entity_type: e.entity_type || 'project', // Fallback, falls ältere App-Versionen kein Typ senden
              entity_id: e.entity_id,
              minutes: e.minutes,
              entry_date: e.entry_date.split('T')[0],
              note: e.note || '',
              created_at: e.created_at || new Date().toISOString()
            });
            successfullySavedIds.push(e.id);
          } catch (err) {
            console.error(`[Sync] Fehler beim Import eines Eintrags:`, err.message);
          }
        }
      })(entries);

      // Bestätigung an den Relay-Server (Löschen der abgeholten Daten)
      if (successfullySavedIds.length > 0) {
        await fetch(`${RELAY_URL}/api/sync/time-entries/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
          body: JSON.stringify({ ids: successfullySavedIds })
        });
      }

      // Desktop-UI informieren, falls Fenster offen
      if (window && !window.isDestroyed()) {
        window.webContents.send('db:update', { table: 'time_entries' });
      }
    }

  } catch (error) {
    console.error('[Sync Error]', error.message);
  }
}

/**
 * Startet die Endlosschleife für die Synchronisation
 */
function startSyncLoop(getDbFn, intervalMs = 30000, window = null) {
  console.log(`[Sync] Loop aktiv (${intervalMs / 1000}s)`);
  
  // Sofortiger Start
  syncWithRelay(getDbFn(), window);
  
  return setInterval(() => {
    const db = getDbFn();
    if (db) syncWithRelay(db, window);
  }, intervalMs);
}

module.exports = { startSyncLoop, syncWithRelay };