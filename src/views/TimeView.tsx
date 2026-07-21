import { useEffect, useState, useCallback } from 'react';
import {
  Play, Square, Plus, Trash2, Clock, ChevronLeft, ChevronRight,
  BarChart3, Calendar, Pencil, CalendarPlus, CalendarCheck, Search, Filter, X
} from 'lucide-react';
import { timeEntries, projects, phases, settings, uuid, posts, run, all } from '../lib/db';
import type { TimeEntry, Project, ProjectPhase, EntityType, SocialPost } from '../types';
import { formatDuration, formatDate, startOfWeek, todayISO, isoWeek } from '../lib/format';
import { useRunningTimer, startTimer } from '../lib/timer';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

// FIX: Bulletproof Datums-Parser (behandelt "YYYY-MM-DD" und "YYYY-MM-DDTHH:mm...")
function toLocalDate(dateInput: string) {
  if (!dateInput) return new Date(0);
  // Nur den Datums-Teil vor dem "T" nehmen
  const dateOnly = dateInput.includes('T') ? dateInput.split('T')[0] : dateInput;
  const [y, m, d] = dateOnly.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
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

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthName(date: Date): string {
  return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

export function TimeView() {
  const [list, setList] = useState<TimeEntry[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [activePhases, setActivePhases] = useState<ProjectPhase[]>([]);
  const [postList, setPostList] = useState<SocialPost[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  
  const [showAdd, setShowAdd] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  
  const [tab, setTab] = useState<'week' | 'capacity'>('week');
  const [weeklyCapacity, setWeeklyCapacity] = useState(40);
  const running = useRunningTimer();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const load = useCallback(async () => {
    // Sicherheitscheck für neue Spalte
    const tableInfo = await all<any>("PRAGMA table_info(project_phases)").catch(() => []);
    if (!tableInfo.some(c => c.name === 'planned_month_key')) {
      await run("ALTER TABLE project_phases ADD COLUMN planned_month_key TEXT;").catch(() => {});
    }

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

  // Wir bestimmen das Basisdatum dynamisch: Entweder der neueste Eintrag (für Tests) oder heute
  const maxDateEntry = list.length > 0 ? list[0].entry_date : todayISO();
  const baseDate = new Date(toLocalDate(maxDateEntry));
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  
  const weekStart = startOfWeek(baseDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  function entityLabel(t: TimeEntry): string {
    if (t.entity_type === 'project') {
      const p = projectList.find(p => p.id === t.entity_id);
      return p?.name || 'Unbekanntes Projekt';
    }
    if (t.entity_type === 'project_phase') {
      const ph = activePhases.find(p => p.id === t.entity_id);
      if (ph) {
        const proj = projectList.find(p => p.id === ph.project_id);
        return `${proj?.name || 'Projekt'} · ${ph.name_override || 'Phase'}`;
      }
      return 'Projektphase';
    }
    if (t.entity_type === 'social_post') return 'Social Post';
    return 'Sonstiges';
  }

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
    const iso = toLocalDate(t.entry_date).toISOString().slice(0, 10);
    (byDay[iso] = byDay[iso] || []).push(t);
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
      </div>

      {tab === 'week' ? (
        <div className="card p-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronLeft size={18} /></button>
              <button onClick={() => setWeekOffset(0)} className="btn-ghost text-sm">Fokus</button>
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
                      <button onClick={() => setEditingEntry(t)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100"><Pencil size={14} /></button>
                      <button onClick={() => timeEntries.remove(t.id).then(load)} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <CapacityTab projectList={projectList} activePhases={activePhases} timeEntries={list} postList={postList} weeklyCapacity={weeklyCapacity} onRefresh={load} searchQuery={searchQuery} />
      )}
    </div>
  );
}

// Hier folgen CapacityTab und TimeEntryModal wie bisher...

// ---------------------------------------------------------------------------
// KAPAZITÄT-TAB (Mit Monats-Toggle)
// ---------------------------------------------------------------------------

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
  
  // Toggle für "Dieser Monat" (0) oder "Nächster Monat" (1)
  const [monthOffset, setMonthOffset] = useState<0 | 1>(0);

  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + monthOffset);
  const currentMonthKey = getMonthKey(targetDate);
  const monthName = getMonthName(targetDate);
  
  // Bereits erfasste Stunden in diesem (ausgewählten) Monat
  const monthMinutes = timeEntries.filter(t => {
    const d = toLocalDate(t.entry_date);
    return d.getFullYear() === targetDate.getFullYear() && d.getMonth() === targetDate.getMonth();
  }).reduce((s, t) => s + t.minutes, 0);
  const monthHoursUsed = monthMinutes / 60;

  const phaseLoggedHours = (phase: ProjectPhase) => {
    let minutes = timeEntries.filter(t => t.entity_type === 'project_phase' && t.entity_id === phase.id).reduce((sum, t) => sum + t.minutes, 0);
    const name = (phase.name_override || '').toLowerCase();
    if (name.includes('social') || name.includes('marketing') || name.includes('content')) {
      const relatedPostIds = postList.filter(post => post.project_id === phase.project_id).map(post => post.id);
      minutes += timeEntries.filter(t => t.entity_type === 'social_post' && t.entity_id && relatedPostIds.includes(t.entity_id)).reduce((sum, t) => sum + t.minutes, 0);
    }
    return minutes / 60;
  };

  // Welche Phasen sind in diesen Monat gepusht?
  const plannedPhasesThisMonth = activePhases.filter(p => (p as any).planned_month_key === currentMonthKey);
  
  const plannedRemainingThisMonth = plannedPhasesThisMonth.reduce((sum, phase) => {
    return sum + Math.max((phase.estimated_hours || 0) - phaseLoggedHours(phase), 0);
  }, 0);

  const monthlyCapacityTotal = (weeklyCapacity / 5) * getWorkdaysInMonth(targetDate);
  const freeHoursThisMonth = Math.max(0, monthlyCapacityTotal - monthHoursUsed - plannedRemainingThisMonth);

  const saveEstimate = async (phaseId: string) => {
    await phases.update(phaseId, { estimated_hours: parseFloat(editHours) || 0 });
    setEditingPhase(null);
    onRefresh();
  };

  // Sortierung: Suchbegriff anwenden und nach Restaufwand sortieren
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
      
      {/* Monat umschalten */}
      <div className="flex bg-surfaceMuted rounded-lg p-0.5 w-fit">
        <button 
          onClick={() => setMonthOffset(0)} 
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${monthOffset === 0 ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          Dieser Monat
        </button>
        <button 
          onClick={() => setMonthOffset(1)} 
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${monthOffset === 1 ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          Nächster Monat
        </button>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-950">Kapazität für {monthName}</h3>
          <Badge tone={monthHoursUsed + plannedRemainingThisMonth > monthlyCapacityTotal ? 'danger' : 'success'}>
            {freeHoursThisMonth.toFixed(1)} h frei
          </Badge>
        </div>
        <div className="h-4 bg-surfaceMuted rounded-full overflow-hidden flex">
          <div className="h-full bg-success-500" style={{ width: `${Math.min((monthHoursUsed / monthlyCapacityTotal) * 100, 100)}%` }} />
          <div className="h-full bg-warning-400 border-l border-surface" style={{ width: `${Math.min((plannedRemainingThisMonth / monthlyCapacityTotal) * 100, 100)}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-success-50/50 text-center border border-success-200/20">
            <p className="text-3xs font-semibold text-success-700 uppercase">Erfasst</p>
            <p className="text-base font-bold text-success-800 mt-1">{monthHoursUsed.toFixed(1)} h</p>
          </div>
          <div className="p-3.5 rounded-xl bg-warning-50/50 text-center border border-warning-200/20">
            <p className="text-3xs font-semibold text-warning-700 uppercase">Verplant (Rest)</p>
            <p className="text-base font-bold text-warning-800 mt-1">{plannedRemainingThisMonth.toFixed(1)} h</p>
          </div>
          <div className="p-3.5 rounded-xl bg-surfaceAlt/60 text-center border border-line">
            <p className="text-3xs font-semibold text-ink-500 uppercase">Budget gesamt</p>
            <p className="text-base font-bold text-ink-900 mt-1">{monthlyCapacityTotal.toFixed(1)} h</p>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink-950 mb-4">Aufgabe dem {monthName} zuordnen</h3>
        {filteredPhases.length === 0 ? (
          <EmptyState title="Keine Phasen gefunden" hint="Versuche es mit einem anderen Suchbegriff." />
        ) : (
          <div className="divide-y divide-line">
            {filteredPhases.map(phase => {
              const project = projectList.find(p => p.id === phase.project_id);
              const logged = phaseLoggedHours(phase);
              const estimated = phase.estimated_hours || 0;
              const remaining = estimated - logged;
              
              // Gehört die Phase zu diesem gewählten Tab-Monat?
              const isPlannedForThisTab = (phase as any).planned_month_key === currentMonthKey;
              // Oder gehört sie zu einem GANZ anderen Monat?
              const isPlannedForOther = (phase as any).planned_month_key && (phase as any).planned_month_key !== currentMonthKey;

              return (
                <div key={phase.id} className="py-4 group">
                  <div className="flex items-center justify-between py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{phase.name_override || 'Phase'}</p>
                      <p className="text-2xs text-ink-500">{project?.name || 'Unbekannt'} · <span className="text-ink-400">{logged.toFixed(1)}h erfasst</span></p>
                    </div>
                    <div className="flex items-center gap-4">
                      
                      {isPlannedForThisTab && <Badge tone="warning">Geplant für {monthName}</Badge>}
                      {isPlannedForOther && <Badge tone="neutral">Geplant in anderem Monat</Badge>}

                      <div className="text-right w-16">
                        <span className={`text-sm font-semibold tabular-nums ${remaining > 0 ? 'text-ink-900' : 'text-success-600'}`}>{remaining > 0 ? `${remaining.toFixed(1)} h` : 'Erledigt! 🎉'}</span>
                      </div>
                      
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Toggle für die Monats-Zuordnung */}
                        <button 
                          onClick={async () => { 
                            const newValue = isPlannedForThisTab ? null : currentMonthKey;
                            await phases.update(phase.id, { planned_month_key: newValue } as any); 
                            onRefresh(); 
                          }} 
                          className={`p-1.5 rounded-lg border transition-all ${isPlannedForThisTab ? 'bg-warning-50 border-warning-200 text-warning-700' : 'border-transparent text-ink-400 hover:bg-surfaceMuted'}`}
                          title={isPlannedForThisTab ? `Aus ${monthName} entfernen` : `Für ${monthName} einplanen`}
                        >
                          {isPlannedForThisTab ? <CalendarCheck size={14} /> : <CalendarPlus size={14} />}
                        </button>
                        
                        <button onClick={() => { setEditingPhase(phase.id); setEditHours(String(phase.estimated_hours || '')); }} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100 transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => startTimer('project_phase', phase.id, `${project?.name} · ${phase.name_override}`)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100 transition-all">
                          <Play size={13} />
                        </button>
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

// ---------------------------------------------------------------------------

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

  const availablePhases = activePhases.filter(ph => ph.project_id === selectedProjectId);

  function submit() {
    const minutes = Math.round(parseFloat(hours || '0') * 60);
    if (minutes <= 0) return;

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
              setSelectedPhaseId(''); 
            }}
          >
            <option value="">— Kein Projekt / Allgemein —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

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