// sync.cjs
const RELAY_URL =  'https://relay.fundament-studio.de';
const RELAY_TOKEN =  'be0e3b7a77a37875b2d58e9eb7955afe30dffa8bdc7f4f29c48a50b65437d2cc';

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
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Hilfsfunktion: Gibt "YYYY-MM" zurück
function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function syncWithRelay(db, window) {
  if (!db) return;

  try {
    console.log('[Sync] Starte Synchronisierung...');

    // A. Monats- und Wochen-Limit
    const capRow = db.prepare("SELECT value FROM app_settings WHERE key = 'weekly_capacity_hours'").get();
    const weeklyCapacity = capRow ? parseFloat(capRow.value) : 40;
    const monthlyLimit = (weeklyCapacity / 5) * getWorkdaysInMonth(new Date());

    const currentMonthKey = getMonthKey(new Date());
    const weekStartStr = getWeekStart(new Date()).toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().slice(0, 10);

    // B. Erfasste Ist-Stunden
    const trackedMonth = db.prepare(`SELECT SUM(minutes) as total FROM time_entries WHERE entry_date >= ?`).get(monthStartStr);
    const trackedHoursMonth = (trackedMonth.total || 0) / 60;

    const trackedWeek = db.prepare(`SELECT SUM(minutes) as total FROM time_entries WHERE entry_date >= ?`).get(weekStartStr);
    const trackedWeekHours = (trackedWeek.total || 0) / 60;

    // C. Geplante Soll-Stunden (STRIKT GETRENNT NACH MONAT)
    // Wir übergeben dem Mobile-Client nur die noch verbleibenden (Soll - Ist) Stunden
    const plannedPhases = db.prepare(`
      SELECT id, estimated_hours, planned_month_key 
      FROM project_phases 
      WHERE status != 'completed' AND estimated_hours > 0
    `).all();

    let plannedHoursMonthRemaining = 0;
    let plannedHoursTotalRemaining = 0;

    for (const phase of plannedPhases) {
      const logged = db.prepare(`SELECT SUM(minutes) as total FROM time_entries WHERE entity_type = 'project_phase' AND entity_id = ?`).get(phase.id);
      const loggedHours = (logged.total || 0) / 60;
      const remaining = Math.max(0, phase.estimated_hours - loggedHours);
      
      plannedHoursTotalRemaining += remaining;

      // Wenn die Phase explizit diesem Monat zugeordnet ist
      if (phase.planned_month_key === currentMonthKey) {
        plannedHoursMonthRemaining += remaining;
      }
    }

    const projects = db.prepare(`SELECT id, name FROM projects WHERE status != 'completed'`).all();
    const phasesData = db.prepare(`
      SELECT pp.id, pp.project_id, pp.estimated_hours, COALESCE(pp.name_override, pti.name, 'Phase') as name
      FROM project_phases pp 
      LEFT JOIN phase_template_items pti ON pp.phase_template_item_id = pti.id
    `).all();

    const snapshotPayload = {
      projects: projects.map(p => ({
        id: p.id, 
        name: p.name, 
        color: '#D48166',
        phases: phasesData.filter(ph => ph.project_id === p.id).map(ph => ({ 
          id: ph.id, 
          name: ph.name, 
          estimated_hours: ph.estimated_hours || 0 
        }))
      })),
      phases: phasesData,
      stats: {
        month_name: new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
        monthly_limit: monthlyLimit,
        weekly_limit: weeklyCapacity, 
        tracked_hours: trackedHoursMonth,
        tracked_hours_week: trackedWeekHours, 
        planned_hours_month: plannedHoursMonthRemaining, // NEU: Nur für den aktuellen Monat geplant!
        planned_hours_total: plannedHoursTotalRemaining
      },
      generated_at: new Date().toISOString()
    };

    const pushRes = await fetch(`${RELAY_URL}/api/sync/projects-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
      body: JSON.stringify(snapshotPayload)
    });

    if (pushRes.ok) {
      console.log(`[Sync] Snapshot hochgeladen (Ist Monat: ${trackedHoursMonth.toFixed(1)}h, Soll Monat: ${plannedHoursMonthRemaining.toFixed(1)}h)`);
    }

    // 3. ZEITEN VOM HANDY ABHOLEN
    const pullRes = await fetch(`${RELAY_URL}/api/sync/time-entries/pending`, {
      headers: { 'Authorization': `Bearer ${RELAY_TOKEN}` }
    });
    const { entries } = await pullRes.json();

    if (entries && entries.length > 0) {
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
              entity_type: e.entity_type || 'project',
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

      if (successfullySavedIds.length > 0) {
        await fetch(`${RELAY_URL}/api/sync/time-entries/ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
          body: JSON.stringify({ ids: successfullySavedIds })
        });
      }

      if (window && !window.isDestroyed()) {
        window.webContents.send('db:update', { table: 'time_entries' });
      }
    }

  } catch (error) {
    console.error('[Sync Error]', error.message);
  }
}

function startSyncLoop(getDbFn, intervalMs = 30000, window = null) {
  console.log(`[Sync] Loop aktiv (${intervalMs / 1000}s)`);
  syncWithRelay(getDbFn(), window);
  return setInterval(() => {
    const db = getDbFn();
    if (db) syncWithRelay(db, window);
  }, intervalMs);
}

module.exports = { startSyncLoop, syncWithRelay };