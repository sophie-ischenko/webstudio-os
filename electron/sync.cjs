// sync.cjs
const RELAY_URL = 'https://relay.fundament-studio.de';
const RELAY_TOKEN = 'be0e3b7a77a37875b2d58e9eb7955afe30dffa8bdc7f4f29c48a50b65437d2cc';

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

// Lokal-Formatierung ohne UTC-Offset-Gefahr
function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function syncWithRelay(db, window, weeklyCapacity) {
  if (!db) return;
  if (typeof weeklyCapacity !== 'number' || isNaN(weeklyCapacity)) {
    weeklyCapacity = 40;
  }

  try {
    console.log('[Sync] Starte Synchronisierung...');

    // 1. DYNAMISCHE ZEIT-ERKENNUNG
    const maxDateRow = db.prepare("SELECT MAX(entry_date) as max_date FROM time_entries").get();
    let d0 = new Date(); 
    if (maxDateRow && maxDateRow.max_date) {
      const parsedDate = new Date(maxDateRow.max_date);
      if (!isNaN(parsedDate.getTime())) d0 = parsedDate;
    }
    const d1 = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);

    const limit0 = (weeklyCapacity / 5) * getWorkdaysInMonth(d0);
    const limit1 = (weeklyCapacity / 5) * getWorkdaysInMonth(d1);
    const key0 = getMonthKey(d0);
    const key1 = getMonthKey(d1);

    // 2. ERFASSTE ZEITEN
    const tracked0 = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date LIKE ?`).get(key0 + '%');
    const tracked1 = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date LIKE ?`).get(key1 + '%');
    
    // Wochenzeit mit Lokal-Datum-String
    const weekStartStr = toLocalDateStr(getWeekStart(d0));
    const trackedWeek = db.prepare(`SELECT SUM(minutes) as t FROM time_entries WHERE entry_date >= ?`).get(weekStartStr);

    // 3. PHASEN & RESTAUFWAND
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

    const mappedProjects = projects.map(p => ({
      id: p.id, name: p.name, color: '#D48166',
      phases: timerPhases.filter(ph => ph.project_id === p.id)
    }));

    // Wir nutzen den "Dummy-Projekt" Hack, um sicherzugehen, dass stats durch den Relay-Server kommen
    const statsDummy = {
      id: "system_stats_dummy_id_1337",
      name: "__SYSTEM_STATS__",
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
      projects: [...mappedProjects, statsDummy],
      phases: timerPhases,
      generated_at: new Date().toISOString()
    };

    const pushRes = await fetch(`${RELAY_URL}/api/sync/projects-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
      body: JSON.stringify(snapshotPayload)
    });

    if (pushRes.ok) console.log(`[Sync] Snapshot erfolgreich hochgeladen.`);

    // 4. ZEITEN VOM HANDY ABHOLEN
    const pullRes = await fetch(`${RELAY_URL}/api/sync/time-entries/pending`, { headers: { 'Authorization': `Bearer ${RELAY_TOKEN}` } });
    const { entries } = await pullRes.json();

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
              id: e.id, 
              entity_type: e.entity_type || 'project', // Hier wird jetzt der Typ vom Handy übernommen!
              entity_id: e.entity_id,
              minutes: e.minutes, 
              entry_date: e.entry_date.split('T')[0], 
              note: e.note || '', 
              created_at: e.created_at || new Date().toISOString()
            });
            successfullySavedIds.push(e.id);
          } catch (err) { console.error(`[Sync] Fehler:`, err.message); }
        }
      })(entries);

      if (successfullySavedIds.length > 0) {
        await fetch(`${RELAY_URL}/api/sync/time-entries/ack`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RELAY_TOKEN}` },
          body: JSON.stringify({ ids: successfullySavedIds })
        });
      }
      if (window && !window.isDestroyed()) window.webContents.send('db:update', { table: 'time_entries' });
    }
  } catch (error) { console.error('[Sync Error]', error.message); }
}

function startSyncLoop(getDbFn, intervalMs = 30000, window = null, getWeeklyCapacityFn = () => 40) {
  console.log(`[Sync] Loop aktiv (${intervalMs / 1000}s)`);
  syncWithRelay(getDbFn(), window, getWeeklyCapacityFn());
  return setInterval(() => {
    const db = getDbFn();
    if (db) syncWithRelay(db, window, getWeeklyCapacityFn());
  }, intervalMs);
}

module.exports = { startSyncLoop, syncWithRelay };