import { useEffect, useState, useCallback } from 'react';
import {
  Play, Square, Plus, Trash2, Clock, ChevronLeft, ChevronRight,
  BarChart3, Calendar, Pencil, CalendarPlus, CalendarCheck, Search, Filter, X
} from 'lucide-react';
import { timeEntries, projects, phases, settings, uuid, posts } from '../lib/db';
import type { TimeEntry, Project, ProjectPhase, EntityType, SocialPost } from '../types';
import { formatDuration, formatDate, startOfWeek, todayISO, isoWeek } from '../lib/format';
import { useRunningTimer, startTimer, stopAndSave, formatElapsed } from '../lib/timer';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

// Zeitzonensicherer Datums-Parser
function toLocalDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWorkdaysInMonth(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  let workdays = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) workdays++;
  }
  return workdays;
}

function weekKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const ws = startOfWeek(d);
  return `${ws.getFullYear()}-W${String(isoWeek(ws)).padStart(2, '0')}`;
}

export function TimeView() {
  const [list, setList] = useState<TimeEntry[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [activePhases, setActivePhases] = useState<ProjectPhase[]>([]);
  const [postList, setPostList] = useState<SocialPost[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  
  // NEU: States für Erstellen und Bearbeiten
  const [showAdd, setShowAdd] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  
  const [tab, setTab] = useState<'week' | 'capacity'>('week');
  const [weeklyCapacity, setWeeklyCapacity] = useState(40);
  const running = useRunningTimer();

  // FILTER STATES
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const load = useCallback(async () => {
    const [times, projs, psts] = await Promise.all([
      timeEntries.list(),
      projects.list(),
      posts.list()
    ]);
    
    setList(times);
    setProjectList(projs);
    setPostList(psts);

    const result: ProjectPhase[] = [];
    for (const p of projs.filter(p => p.status === 'active')) {
      const ps = await phases.listByProject(p.id);
      result.push(...ps.filter(ph => ph.status === 'open' || ph.status === 'in_progress'));
    }
    setActivePhases(result);

    const capRow = await settings.get('weekly_capacity_hours');
    if (capRow) setWeeklyCapacity(parseFloat(capRow.value) || 40);
  }, []);

  useEffect(() => { load(); }, [load, running]);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekStart = startOfWeek(baseDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

 // Ersetze die entityLabel Funktion durch diese robustere Version:
function entityLabel(t: TimeEntry): string {
  if (t.entity_type === 'project') {
    const p = projectList.find(p => p.id === t.entity_id);
    return p?.name || 'Unbekanntes Projekt';
  }
  
  if (t.entity_type === 'project_phase') {
    // Zuerst Phase suchen (wir suchen in activePhases, aber falls nicht gefunden, 
    // brauchen wir eigentlich eine Liste ALLER Phasen für die Historie)
    const ph = activePhases.find(p => p.id === t.entity_id);
    
    // WICHTIG: Falls die Phase nicht in activePhases ist (weil abgeschlossen), 
    // sollte sie trotzdem gelabelt werden können. 
    // Tipp: Lade im useEffect alle Phasen, nicht nur aktive, oder speichere den Namen im TimeEntry.
    if (ph) {
      const proj = projectList.find(p => p.id === ph.project_id);
      return `${proj?.name || 'Projekt'} · ${ph.name_override || 'Phase'}`;
    }
    return 'Projektphase (archiviert)'; 
  }
  
  if (t.entity_type === 'social_post') return 'Social Post';
  return 'Sonstiges';
}

  // GEFILTERTE EINTRÄGE FÜR DIE WOCHENANSICHT
  const filteredWeekEntries = list.filter(t => {
    const d = toLocalDate(t.entry_date);
    const isInWeek = d >= weekStart && d <= weekEnd;
    if (!isInWeek) return false;

    const label = entityLabel(t).toLowerCase();
    const note = (t.note || '').toLowerCase();
    const matchesSearch = label.includes(searchQuery.toLowerCase()) || note.includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === 'all' || t.entity_type === typeFilter;

    return matchesSearch && matchesType;
  });

  const byDay: Record<string, TimeEntry[]> = {};
  filteredWeekEntries.forEach(t => {
    (byDay[t.entry_date] = byDay[t.entry_date] || []).push(t);
  });
  const days = Object.keys(byDay).sort().reverse();
  const weekTotal = filteredWeekEntries.reduce((s, t) => s + t.minutes, 0);

  const dayTotals: { date: string; minutes: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    dayTotals.push({ date: iso, minutes: (byDay[iso] || []).reduce((s, t) => s + t.minutes, 0) });
  }
  const maxDay = Math.max(...dayTotals.map(d => d.minutes), 60);

  async function addManual(date: string, minutes: number, note: string, entityType: EntityType, entityId: string | null) {
    const id = await uuid();
    await timeEntries.insert({
      id, entity_type: entityType, entity_id: entityId,
      minutes, entry_date: date, note: note || null,
      created_at: new Date().toISOString(),
    });
    load();
  }

  // NEU: Update Funktion
  async function updateManual(id: string, date: string, minutes: number, note: string, entityType: EntityType, entityId: string | null) {
    await timeEntries.update(id, {
      entity_type: entityType, 
      entity_id: entityId,
      minutes, 
      entry_date: date, 
      note: note || null,
    });
    load();
  }

  async function removeEntry(id: string) {
    await timeEntries.remove(id);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Zeiterfassung</h1>
          <p className="text-sm text-ink-500">Live-Timer & Kapazitätsplanung</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surfaceMuted p-0.5">
            <button onClick={() => setTab('week')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${tab === 'week' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}><Calendar size={14} /> Woche</button>
            <button onClick={() => setTab('capacity')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${tab === 'capacity' ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}><BarChart3 size={14} /> Kapazität</button>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-outline"><Plus size={16} /> Manuell</button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="card p-4 flex flex-wrap items-center gap-4 bg-surface shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            type="text"
            placeholder="Nach Projekt, Phase oder Notiz filtern..."
            className="input pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-ink-400" />
          <select 
            className="input !py-1.5 text-xs w-auto"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">Alle Kategorien</option>
            <option value="project">Projekte</option>
            <option value="project_phase">Projektphasen</option>
            <option value="social_post">Social Posts</option>
            <option value="other">Sonstiges</option>
          </select>
        </div>
      </div>

      {tab === 'week' ? (
        <div className="card p-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronLeft size={18} /></button>
              <button onClick={() => setWeekOffset(0)} className="btn-ghost text-sm">Heute</button>
              <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronRight size={18} /></button>
            </div>
            <p className="text-sm font-medium text-ink-900">{formatDate(weekStart.toISOString())} – {formatDate(weekEnd.toISOString())}</p>
            <div className="text-right">
              <p className="text-2xs text-ink-500 uppercase tracking-wider">Ergebnis</p>
              <p className="stat-value text-accent-700">{formatDuration(weekTotal)}</p>
            </div>
          </div>

          <div className="flex items-end justify-between gap-3 h-32">
            {dayTotals.map(d => {
              const heightPct = (d.minutes / maxDay) * 100;
              const isToday = d.date === todayISO();
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2">
                  <span className={`text-[11px] tabular-nums font-medium ${isToday ? 'text-accent-700' : 'text-ink-600'}`}>{d.minutes > 0 ? `${Math.round((d.minutes / 60) * 10) / 10}h` : '0h'}</span>
                  <div className="w-full flex-1 flex items-end">
                    <div className={`w-full rounded-t-md transition-all duration-500 ${isToday ? 'bg-accent-600' : 'bg-accent-300'}`} style={{ height: `${Math.max(heightPct, 2)}%` }} />
                  </div>
                  <span className={`text-[11px] font-medium ${isToday ? 'text-ink-900' : 'text-ink-500'}`}>{new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2)}</span>
                </div>
              );
            })}
          </div>

          {days.length === 0 ? (
            <EmptyState icon={<Clock size={24} />} title="Keine Treffer gefunden" hint="Passe deine Filter oder die Woche an." />
          ) : (
            <div className="space-y-5">
              {days.map(date => (
                <div key={date} className="space-y-2">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-ink-500">{formatDate(date)} · {formatDuration(byDay[date].reduce((s, t) => s + t.minutes, 0))}</p>
                  {byDay[date].map(t => (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surfaceAlt/40 group">
                      <span className="text-sm font-medium text-ink-900 flex-1">{entityLabel(t)}</span>
                      {t.note && <span className="text-2xs text-ink-500 truncate max-w-[200px]">{t.note}</span>}
                      <Badge tone="neutral">{formatDuration(t.minutes)}</Badge>
                      {/* NEU: Bearbeiten-Button */}
                      <button onClick={() => setEditingEntry(t)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100"><Pencil size={14} /></button>
                      <button onClick={() => removeEntry(t.id)} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <CapacityTab
          projectList={projectList}
          activePhases={activePhases}
          timeEntries={list}
          postList={postList}
          weeklyCapacity={weeklyCapacity}
          onRefresh={load}
          searchQuery={searchQuery}
        />
      )}

      {/* MODIFIZIERT: Nutzt nun ein kombiniertes Modal für Hinzufügen & Bearbeiten */}
      <TimeEntryModal 
        open={showAdd || editingEntry !== null} 
        onClose={() => { setShowAdd(false); setEditingEntry(null); }} 
        projects={projectList} 
        activePhases={activePhases} 
        onSave={async (date, minutes, note, entityType, entityId) => {
          if (editingEntry) {
            await updateManual(editingEntry.id, date, minutes, note, entityType, entityId);
          } else {
            await addManual(date, minutes, note, entityType, entityId);
          }
        }} 
        entryToEdit={editingEntry}
      />
    </div>
  );
}

function CapacityTab({ projectList, activePhases, timeEntries, postList, weeklyCapacity, onRefresh, searchQuery }: {
  projectList: Project[];
  activePhases: ProjectPhase[];
  timeEntries: TimeEntry[];
  postList: SocialPost[];
  weeklyCapacity: number;
  onRefresh: () => void;
  searchQuery: string;
}) {
  const [editingPhase, setEditingPhase] = useState<string | null>(null);
  const [editHours, setEditHours] = useState('');
  const currentWeekKey = weekKey(0);
  const weekStart = startOfWeek(new Date());
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const weekMinutes = timeEntries.filter(t => toLocalDate(t.entry_date) >= weekStart).reduce((s, t) => s + t.minutes, 0);
  const monthMinutes = timeEntries.filter(t => toLocalDate(t.entry_date) >= monthStart).reduce((s, t) => s + t.minutes, 0);
  const weekHoursUsed = weekMinutes / 60;
  const monthHoursUsed = monthMinutes / 60;

  const weekHoursPlanned = activePhases.filter(p => (p as any).planned_week_key === currentWeekKey).reduce((s, p) => s + (p.estimated_hours || 0), 0);
  const freeHoursThisWeek = Math.max(0, weeklyCapacity - weekHoursUsed - weekHoursPlanned);
  const monthlyCapacityTotal = (weeklyCapacity / 5) * getWorkdaysInMonth(new Date());
  
  const phaseLoggedHours = (phase: ProjectPhase) => {
    let minutes = timeEntries.filter(t => t.entity_type === 'project_phase' && t.entity_id === phase.id).reduce((sum, t) => sum + t.minutes, 0);
    const name = (phase.name_override || '').toLowerCase();
    if (name.includes('social') || name.includes('marketing') || name.includes('content')) {
      const relatedPostIds = postList.filter(post => post.project_id === phase.project_id).map(post => post.id);
      minutes += timeEntries.filter(t => t.entity_type === 'social_post' && t.entity_id && relatedPostIds.includes(t.entity_id)).reduce((sum, t) => sum + t.minutes, 0);
    }
    return minutes / 60;
  };

  const plannedRemaining = activePhases.reduce((sum, phase) => sum + Math.max((phase.estimated_hours || 0) - phaseLoggedHours(phase), 0), 0);
  const freeHoursThisMonth = Math.max(0, monthlyCapacityTotal - monthHoursUsed - plannedRemaining);

  const saveEstimate = async (phaseId: string) => {
    await phases.update(phaseId, { estimated_hours: parseFloat(editHours) || 0 });
    setEditingPhase(null);
    onRefresh();
  };

  // SORTIERUNG & FILTERUNG DER PHASEN
  const filteredPhases = activePhases.filter(ph => {
    const projName = projectList.find(p => p.id === ph.project_id)?.name || '';
    const phaseName = ph.name_override || '';
    return projName.toLowerCase().includes(searchQuery.toLowerCase()) || phaseName.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => {
    const aLogged = phaseLoggedHours(a);
    const bLogged = phaseLoggedHours(b);
    const aRemaining = (a.estimated_hours || 0) - aLogged;
    const bRemaining = (b.estimated_hours || 0) - bLogged;
    return bRemaining - aRemaining;
  });

  return (
    <div className="space-y-6">
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-950">Wochen-Auslastung</h3>
          <Badge tone={weekHoursUsed + weekHoursPlanned > weeklyCapacity ? 'danger' : 'success'}>{freeHoursThisWeek.toFixed(1)} h frei</Badge>
        </div>
        <div className="h-4 bg-surfaceMuted rounded-full overflow-hidden flex">
          <div className="h-full bg-success-500" style={{ width: `${Math.min((weekHoursUsed / weeklyCapacity) * 100, 100)}%` }} />
          <div className="h-full bg-warning-400 border-l border-surface" style={{ width: `${Math.min((weekHoursPlanned / weeklyCapacity) * 100, 100)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-success-50/50 text-center border border-success-200/20"><p className="text-3xs font-semibold text-success-700 uppercase">Erfasst</p><p className="text-base font-bold text-success-800 mt-1">{weekHoursUsed.toFixed(1)} h</p></div>
          <div className="p-3.5 rounded-xl bg-warning-50/50 text-center border border-warning-200/20"><p className="text-3xs font-semibold text-warning-700 uppercase">Geplant</p><p className="text-base font-bold text-warning-800 mt-1">{weekHoursPlanned.toFixed(1)} h</p></div>
          <div className="p-3.5 rounded-xl bg-surfaceAlt/60 text-center border border-line"><p className="text-3xs font-semibold text-ink-500 uppercase">Frei</p><p className="text-base font-bold text-ink-900 mt-1">{freeHoursThisWeek.toFixed(1)} h</p></div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink-950">Monats-Kapazität</h3><Badge tone={monthHoursUsed + plannedRemaining > monthlyCapacityTotal ? 'danger' : 'success'}>{freeHoursThisMonth.toFixed(1)} h frei</Badge></div>
        <div className="h-4 bg-surfaceMuted rounded-full overflow-hidden flex">
          <div className="h-full bg-success-500" style={{ width: `${Math.min((monthHoursUsed / monthlyCapacityTotal) * 100, 100)}%` }} />
          <div className="h-full bg-warning-400 border-l border-surface" style={{ width: `${Math.min((plannedRemaining / monthlyCapacityTotal) * 100, 100)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-success-50/50 text-center border border-success-200/20"><p className="text-3xs font-semibold text-success-700 uppercase">Erfasst</p><p className="text-base font-bold text-success-800 mt-1">{monthHoursUsed.toFixed(1)} h</p></div>
          <div className="p-3.5 rounded-xl bg-warning-50/50 text-center border border-warning-200/20"><p className="text-3xs font-semibold text-warning-700 uppercase">Soll-Rest</p><p className="text-base font-bold text-warning-800 mt-1">{plannedRemaining.toFixed(1)} h</p></div>
          <div className="p-3.5 rounded-xl bg-surfaceAlt/60 text-center border border-line"><p className="text-3xs font-semibold text-ink-500 uppercase">Frei</p><p className="text-base font-bold text-ink-900 mt-1">{freeHoursThisMonth.toFixed(1)} h</p></div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink-950 mb-4">Projektphasen (Kapazitätsplanung)</h3>
        {filteredPhases.length === 0 ? (
          <EmptyState title="Keine Phasen gefunden" hint="Versuche es mit einem anderen Suchbegriff." />
        ) : (
          <div className="divide-y divide-line">
            {filteredPhases.map(phase => {
              const project = projectList.find(p => p.id === phase.project_id);
              const logged = phaseLoggedHours(phase);
              const estimated = phase.estimated_hours || 0;
              const remaining = estimated - logged;
              const isPlanned = (phase as any).planned_week_key === currentWeekKey;

              return (
                <div key={phase.id} className="py-4 group">
                  <div className="flex items-center justify-between py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{phase.name_override || 'Phase'}</p>
                      <p className="text-2xs text-ink-500">{project?.name || 'Unbekannt'} · <span className="text-ink-400">{logged.toFixed(1)}h erfasst</span></p>
                    </div>
                    <div className="flex items-center gap-4">
                      {isPlanned && <Badge tone="warning">Woche</Badge>}
                      <div className="text-right">
                        <span className={`text-sm font-semibold tabular-nums ${remaining > 0 ? 'text-ink-900' : 'text-success-600'}`}>{remaining > 0 ? `${remaining.toFixed(1)} h` : 'Erledigt! 🎉'}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={async () => { await phases.update(phase.id, { planned_week_key: isPlanned ? null : currentWeekKey } as any); onRefresh(); }} className={`p-1 rounded ${isPlanned ? 'text-warning-600' : 'text-ink-400 hover:text-warning-500 opacity-0 group-hover:opacity-100 transition-all'}`}>{isPlanned ? <CalendarCheck size={14} /> : <CalendarPlus size={14} />}</button>
                        <button onClick={() => { setEditingPhase(phase.id); setEditHours(String(phase.estimated_hours || '')); }} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100 transition-all"><Pencil size={13} /></button>
                        <button onClick={() => startTimer('project_phase', phase.id, `${project?.name} · ${phase.name_override}`)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100 transition-all"><Play size={13} /></button>
                      </div>
                    </div>
                  </div>
                  {editingPhase === phase.id && (
                    <div className="mt-2 flex items-center gap-2 bg-surfaceAlt/50 p-2 rounded-lg">
                      <input type="number" step="0.5" className="input w-24 h-8 text-xs" value={editHours} onChange={e => setEditHours(e.target.value)} autoFocus />
                      <button onClick={() => saveEstimate(phase.id)} className="btn-primary text-xs !py-1">Sichern</button>
                      <button onClick={() => setEditingPhase(null)} className="btn-ghost text-xs !py-1">Abbrechen</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TimeEntryModal({ open, onClose, projects, activePhases, onSave, entryToEdit }: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  activePhases: ProjectPhase[];
  onSave: (date: string, minutes: number, note: string, entityType: EntityType, entityId: string | null) => void;
  entryToEdit: TimeEntry | null;
}) {
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState('1');
  const [note, setNote] = useState('');
  
  // Wir trennen Projekt-Auswahl und Phasen-Auswahl
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('project');

  useEffect(() => {
    if (entryToEdit && open) {
      setDate(entryToEdit.entry_date);
      setHours((entryToEdit.minutes / 60).toString());
      setNote(entryToEdit.note || '');
      
      if (entryToEdit.entity_type === 'project_phase') {
        const ph = activePhases.find(p => p.id === entryToEdit.entity_id);
        setEntityType('project_phase');
        setSelectedPhaseId(entryToEdit.entity_id || '');
        setSelectedProjectId(ph?.project_id || '');
      } else {
        setEntityType(entryToEdit.entity_type);
        setSelectedProjectId(entryToEdit.entity_id || '');
      }
    } else {
      setDate(todayISO());
      setHours('1');
      setNote('');
      setSelectedProjectId('');
      setSelectedPhaseId('');
      setEntityType('project');
    }
  }, [entryToEdit, open, activePhases]);

  // Filtert die Phasen basierend auf dem gewählten Projekt
  const availablePhases = activePhases.filter(ph => ph.project_id === selectedProjectId);

  function submit() {
    const minutes = Math.round(parseFloat(hours || '0') * 60);
    if (minutes <= 0) return;

    // Logik: Wenn eine Phase gewählt ist, ist der Typ 'project_phase', sonst 'project'
    const finalType = selectedPhaseId ? 'project_phase' : 'project';
    const finalId = selectedPhaseId || selectedProjectId || null;

    onSave(date, minutes, note, finalType, finalId);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={entryToEdit ? "Zeit bearbeiten" : "Zeit erfassen"} size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Datum"><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Stunden"><input type="number" step="0.25" className="input" value={hours} onChange={e => setHours(e.target.value)} /></Field>
        </div>

        <Field label="Projekt">
          <select 
            className="input" 
            value={selectedProjectId} 
            onChange={e => {
              setSelectedProjectId(e.target.value);
              setSelectedPhaseId(''); // Reset Phase wenn Projekt sich ändert
            }}
          >
            <option value="">— Kein Projekt / Allgemein —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        {/* Die Phasen erscheinen nur, wenn ein Projekt gewählt wurde */}
        {selectedProjectId && (
          <Field label="Phase (Optional)">
            <select 
              className="input" 
              value={selectedPhaseId} 
              onChange={e => setSelectedPhaseId(e.target.value)}
            >
              <option value="">— Gesamtes Projekt (keine spezifische Phase) —</option>
              {availablePhases.map(ph => (
                <option key={ph.id} value={ph.id}>{ph.name_override}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Notiz">
          <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Was hast du gemacht?" />
        </Field>
      </div>
    </Modal>
  );
}