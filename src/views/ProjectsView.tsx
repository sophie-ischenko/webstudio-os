import { useEffect, useState, useCallback } from 'react';
import {
  Plus, ChevronRight, Play, Square, Trash2, Check, Link2, FileText,
  CalendarClock, FolderKanban, ArrowLeft, Pencil, Image, X, Download, Eye,
} from 'lucide-react';
import {
  projects, phases, checklist, assets, templates, uuid, clients,
} from '../lib/db';
import type {
  Project, ProjectPhase, ProjectChecklistItem, ProjectAsset,
  PhaseTemplate, PhaseTemplateItem, ChecklistTemplateItem, ProjectStatus, PhaseStatus,
  Client,
} from '../types';
import { formatDate, relativeDeadline, todayISO } from '../lib/format';
import { startTimer, useRunningTimer, stopAndSave, formatElapsed } from '../lib/timer';
import { Modal, Badge, EmptyState, Field, ConfirmInline } from '../components/ui';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Aktiv', paused: 'Pausiert', done: 'Abgeschlossen', cancelled: 'Abgebrochen',
};
const PHASE_LABELS: Record<PhaseStatus, string> = {
  open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', skipped: 'Übersprungen',
};

export function ProjectsView() {
  const [list, setList] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<'all' | ProjectStatus>('all');

  const load = useCallback(async () => {
    setList(await projects.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? list : list.filter(p => p.status === filter);

  if (selected) {
    return <ProjectDetail project={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Projekte</h1>
          <p className="text-sm text-ink-500 mt-0.5">{list.length} insgesamt · {list.filter(p => p.status === 'active').length} aktiv</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={16} /> Neues Projekt
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(['all', 'active', 'paused', 'done', 'cancelled'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip transition-colors ${filter === f ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
          >
            {f === 'all' ? 'Alle' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={28} />}
            title="Keine Projekte in diesem Filter"
            hint="Lege ein neues Projekt an oder wechsle den Filter."
            action={<button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} /> Neues Projekt</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p)} onTimer={() => startTimer('project', p.id, p.name)} />)}
        </div>
      )}

      <NewProjectModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProjectCard({ project, onOpen, onTimer }: { project: Project; onOpen: () => void; onTimer: () => void }) {
  const dl = relativeDeadline(project.target_end_date);
  const statusTone: Record<ProjectStatus, 'accent' | 'neutral' | 'success' | 'danger'> = {
    active: 'accent', paused: 'neutral', done: 'success', cancelled: 'danger',
  };
  return (
    <div className="card card-hover p-5 cursor-pointer" onClick={onOpen}>
      <div className="flex items-start justify-between mb-3">
        <Badge tone={statusTone[project.status]}>{STATUS_LABELS[project.status]}</Badge>
        <button
          onClick={(e) => { e.stopPropagation(); onTimer(); }}
          className="p-1.5 rounded-md text-accent-600 hover:bg-accent-50"
          title="Timer starten"
        >
          <Play size={14} />
        </button>
      </div>
      <h3 className="font-display text-base font-medium text-ink-900 mb-1">{project.name}</h3>
      <p className="text-sm text-ink-500">{project.client_name || 'Keine Kundin'}</p>
      {project.target_end_date && (
        <div className="mt-3 flex items-center gap-2">
          <CalendarClock size={13} className="text-ink-400" />
          <span className="text-2xs text-ink-500">{formatDate(project.target_end_date)}</span>
          <Badge tone={dl.tone === 'overdue' ? 'danger' : dl.tone === 'soon' ? 'warning' : 'neutral'}>{dl.label}</Badge>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-2xs text-ink-400">
        <span>Seit {formatDate(project.start_date)}</span>
        <span className="flex items-center gap-1 text-accent-600">Öffnen <ChevronRight size={12} /></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

// Korrigierte ProjectDetail() Funktion - ersetze die ganze Funktion damit:

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [phaseList, setPhaseList] = useState<ProjectPhase[]>([]);
  const [checklistMap, setChecklistMap] = useState<Record<string, ProjectChecklistItem[]>>({});
  const [assetList, setAssetList] = useState<ProjectAsset[]>([]);
  const [notes, setNotes] = useState(project.notes || '');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [showTemplateImport, setShowTemplateImport] = useState(false);
  const [tplList, setTplList] = useState<PhaseTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [tplItems, setTplItems] = useState<Record<string, PhaseTemplateItem[]>>({});
  const running = useRunningTimer();
  const isThisRunning = running?.entityType === 'project' && running?.entityId === project.id;

  const [projectStatus, setProjectStatus] = useState(project.status);

  const load = useCallback(async () => {
    const ps = await phases.listByProject(project.id);
    setPhaseList(ps);
    const checks: Record<string, ProjectChecklistItem[]> = {};
    for (const p of ps) {
      checks[p.id] = await checklist.listByPhase(p.id);
    }
    setChecklistMap(checks);
    setAssetList(await assets.listByProject(project.id));
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showTemplateImport) {
      (async () => {
        const tpls = await templates.list();
        setTplList(tpls);
        const map: Record<string, PhaseTemplateItem[]> = {};
        for (const t of tpls) {
          map[t.id] = await templates.items(t.id);
        }
        setTplItems(map);
      })();
    }
  }, [showTemplateImport]);

  useEffect(() => {
    setProjectStatus(project.status);
  }, [project]);

  // ✅ PROGRESS: Ignoriere übersprungene Phasen
  const progress = (() => {
    const activephases = phaseList.filter(p => p.status !== 'skipped');
    if (activephases.length === 0) return 0;
    const done = activephases.filter(p => p.status === 'done').length;
    return Math.round((done / activephases.length) * 100);
  })();

  // ✅ AUTO-COMPLETE: Wenn 100%, dann Status auf "done" + actual_end_date setzen
  useEffect(() => {
    if (progress === 100 && projectStatus !== 'done') {
      changeProjectStatus('done');
    }
  }, [progress, projectStatus]);

  async function addPhase() {
    if (!newPhaseName.trim()) return;
    const id = await uuid();
    await phases.insert({
      id, project_id: project.id, phase_template_item_id: null,
      name_override: newPhaseName.trim(), status: 'open',
      deadline: null, completed_at: null, position_override: phaseList.length,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    setNewPhaseName('');
    load();
  }

  async function importTemplate() {
    if (!selectedTemplate || !tplItems[selectedTemplate]) return;
    const items = tplItems[selectedTemplate];
    const startPos = phaseList.length;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const phaseId = await uuid();
      await phases.insert({
        id: phaseId, project_id: project.id, phase_template_item_id: it.id,
        name_override: it.name, status: 'open', deadline: null,
        completed_at: null, position_override: startPos + i,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    setShowTemplateImport(false);
    setSelectedTemplate('');
    load();
  }

  // ✅ KORRIGIERT: Neuladen nach Status-Änderung
  async function changeProjectStatus(status: ProjectStatus) {
    await projects.update(project.id, { status });
    if (status === 'done') {
      await projects.update(project.id, { actual_end_date: new Date().toISOString().split('T')[0] });
    }
    setProjectStatus(status);
    load(); // ← Wichtig: Neuladen!
  }

  async function setPhaseStatus(phase: ProjectPhase, status: PhaseStatus) {
    await phases.update(phase.id, {
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
    });
    load();
  }

  async function toggleCheck(_phaseId: string, item: ProjectChecklistItem) {
    const next = item.is_checked ? 0 : 1;
    await checklist.toggle(item.id, next);
    load();
  }

  async function addCheck(phaseId: string, label: string) {
    if (!label.trim()) return;
    const id = await uuid();
    const existing = checklistMap[phaseId] || [];
    await checklist.insert({
      id, project_phase_id: phaseId, checklist_template_item_id: null,
      label_override: label.trim(), is_checked: 0, checked_at: null,
      position_override: existing.length, created_at: new Date().toISOString(),
    });
    load();
  }

  async function removePhase(phaseId: string) {
    await phases.remove(phaseId);
    load();
  }

  async function addAsset(type: ProjectAsset['type'], label: string, value: string, fileMeta?: { name: string; mime: string; size: number }) {
    if (!label.trim() || !value.trim()) return;
    const id = await uuid();
    await assets.insert({
      id, project_id: project.id, project_phase_id: null,
      type, label: label.trim(), value: value.trim(),
      file_name: fileMeta?.name || null, file_mime: fileMeta?.mime || null, file_size: fileMeta?.size || null,
      created_at: new Date().toISOString(),
    });
    load();
  }

  async function removeAsset(id: string) {
    await assets.remove(id);
    load();
  }

  async function saveNotes() {
    await projects.update(project.id, { notes });
    setEditing(false);
  }

  async function deleteProject() {
    await projects.remove(project.id);
    onBack();
  }

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <button onClick={onBack} className="btn-ghost -ml-2 mb-2 text-sm">
          <ArrowLeft size={16} /> Zurück zur Liste
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-medium text-ink-900">{project.name}</h1>
            <p className="text-sm text-ink-500 mt-0.5">{project.client_name || 'Keine Kundin'}</p>
          </div>
          <div className="flex items-center gap-2">
            {isThisRunning ? (
              <button onClick={() => stopAndSave()} className="btn-primary">
                <Square size={14} /> {formatElapsed()} · Stop
              </button>
            ) : (
              <button onClick={() => startTimer('project', project.id, project.name)} className="btn-outline">
                <Play size={14} /> Timer starten
              </button>
            )}
            {confirmDelete ? (
              <ConfirmInline message="Projekt wirklich löschen?" onConfirm={deleteProject} onCancel={() => setConfirmDelete(false)} />
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn-danger">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress + meta */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink-700">Fortschritt</span>
          <span className="text-sm font-semibold text-accent-700 tabular-nums">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-surfaceMuted overflow-hidden">
          <div className="h-full bg-accent-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Status</p>
            <select
              className="mt-0.5 text-sm text-ink-900 bg-transparent border-0 focus:outline-none cursor-pointer font-medium"
              value={projectStatus}
              onChange={(e) => changeProjectStatus(e.target.value as ProjectStatus)}
            >
              {(['active', 'paused', 'done', 'cancelled'] as ProjectStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <Meta label="Start" value={formatDate(project.start_date)} />
          <Meta label="Ziel-Ende" value={formatDate(project.target_end_date)} />
          <Meta label="Tatsächl. Ende" value={formatDate(project.actual_end_date)} />
        </div>
      </div>

      {/* Kundendaten */}
      <ClientPanel project={project} onSaved={load} />

      {/* Phases */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Phasen</h2>
          <button onClick={() => setShowTemplateImport(true)} className="btn-ghost text-sm">
            <Plus size={14} /> Aus Vorlage importieren
          </button>
        </div>
        {phaseList.length === 0 ? (
          <EmptyState title="Noch keine Phasen" hint="Füge die erste Phase hinzu oder importiere aus einer Vorlage." />
        ) : (
          <div className="space-y-3">
            {phaseList.map(phase => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                checks={checklistMap[phase.id] || []}
                onStatus={(s) => setPhaseStatus(phase, s)}
                onToggleCheck={(item) => toggleCheck(phase.id, item)}
                onAddCheck={(label) => addCheck(phase.id, label)}
                onRemove={() => removePhase(phase.id)}
              />
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Neue Phase hinzufügen…"
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPhase(); }}
          />
          <button onClick={addPhase} className="btn-outline"><Plus size={16} /> Hinzufügen</button>
        </div>
      </div>

      {/* Template import modal */}
      {showTemplateImport && (
        <Modal open onClose={() => setShowTemplateImport(false)} title="Phasen aus Vorlage importieren" size="md"
          footer={
            <>
              <button onClick={() => setShowTemplateImport(false)} className="btn-ghost">Abbrechen</button>
              <button onClick={importTemplate} className="btn-primary" disabled={!selectedTemplate}>
                Importieren
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Vorlage auswählen">
              <select
                className="input"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                <option value="">— Bitte wählen —</option>
                {tplList.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            {selectedTemplate && tplItems[selectedTemplate] && (
              <div className="p-3 rounded-lg bg-surfaceAlt/50">
                <p className="text-sm font-medium text-ink-700 mb-2">
                  {tplItems[selectedTemplate].length} Phasen werden importiert:
                </p>
                <ul className="space-y-1">
                  {tplItems[selectedTemplate].map((item, idx) => (
                    <li key={item.id} className="text-sm text-ink-600 flex items-center gap-2">
                      <span className="text-2xs text-ink-400">{idx + 1}.</span>
                      {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Assets + Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AssetPanel assets={assetList} onAdd={addAsset} onRemove={removeAsset} />
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Notizen</h2>
            {editing ? (
              <div className="flex gap-2">
                <button onClick={() => { setNotes(project.notes || ''); setEditing(false); }} className="btn-ghost text-sm">Abbrechen</button>
                <button onClick={saveNotes} className="btn-primary text-sm">Speichern</button>
              </div>
            ) : (
              <button onClick={() => setEditing(true)} className="btn-ghost text-sm"><Pencil size={14} /> Bearbeiten</button>
            )}
          </div>
          {editing ? (
            <textarea
              className="input min-h-[160px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Markdown-fähige Notizen…"
            />
          ) : (
            <p className="text-sm text-ink-700 whitespace-pre-wrap min-h-[160px]">{notes || 'Keine Notizen.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
      <p className="text-sm text-ink-900 mt-0.5">{value}</p>
    </div>
  );
}

function PhaseRow({ phase, checks, onStatus, onToggleCheck, onAddCheck, onRemove }: {
  phase: ProjectPhase;
  checks: ProjectChecklistItem[];
  onStatus: (s: PhaseStatus) => void;
  onToggleCheck: (item: ProjectChecklistItem) => void;
  onAddCheck: (label: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [newCheck, setNewCheck] = useState('');
  const name = phase.name_override || 'Unbenannte Phase';
  const done = checks.filter(c => c.is_checked).length;
  const statusTone: Record<PhaseStatus, 'neutral' | 'accent' | 'success' | 'warning'> = {
    open: 'neutral', in_progress: 'accent', done: 'success', skipped: 'warning',
  };
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-surfaceAlt/40">
        <button onClick={() => setOpen(!open)} className="text-ink-400 hover:text-ink-700">
          <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <span className="flex-1 text-sm font-medium text-ink-900">{name}</span>
        {checks.length > 0 && <span className="text-2xs text-ink-500 tabular-nums">{done}/{checks.length}</span>}
        <Badge tone={statusTone[phase.status]}>{PHASE_LABELS[phase.status]}</Badge>
        <select
          value={phase.status}
          onChange={(e) => onStatus(e.target.value as PhaseStatus)}
          className="text-2xs bg-transparent border-0 text-ink-500 focus:outline-none cursor-pointer"
        >
          {(['open', 'in_progress', 'done', 'skipped'] as PhaseStatus[]).map(s => (
            <option key={s} value={s}>{PHASE_LABELS[s]}</option>
          ))}
        </select>
        <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600"><Trash2 size={14} /></button>
      </div>
      {open && (
        <div className="px-4 py-3 space-y-1.5">
          {checks.map(c => (
            <button key={c.id} onClick={() => onToggleCheck(c)} className="w-full flex items-center gap-2.5 text-left group">
              <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                ${c.is_checked ? 'bg-accent-500 border-accent-500 text-white' : 'border-line group-hover:border-accent-300'}`}>
                {c.is_checked ? <Check size={11} /> : null}
              </span>
              <span className={`text-sm ${c.is_checked ? 'text-ink-400 line-through' : 'text-ink-700'}`}>
                {c.label_override || 'Unbenannt'}
              </span>
            </button>
          ))}
          <div className="flex gap-2 mt-2">
            <input
              className="input flex-1 text-sm"
              placeholder="Checklist-Eintrag…"
              value={newCheck}
              onChange={(e) => setNewCheck(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newCheck.trim()) { onAddCheck(newCheck); setNewCheck(''); } }}
            />
            <button onClick={() => { if (newCheck.trim()) { onAddCheck(newCheck); setNewCheck(''); } }} className="btn-ghost text-sm">
              <Plus size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientPanel({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(project.client_id || '');
  const [name, setName] = useState(project.client_name || '');
  const [company, setCompany] = useState(project.client_company || '');
  const [email, setEmail] = useState(project.client_email || '');
  const [phone, setPhone] = useState(project.client_phone || '');
  const [address, setAddress] = useState(project.client_address || '');

  useEffect(() => {
    if (editing) {
      clients.list().then(setClientList);
    }
  }, [editing]);

  function selectClient(id: string) {
    setSelectedClientId(id);
    if (id === '') {
      setName(''); setCompany(''); setEmail(''); setPhone(''); setAddress('');
    } else {
      const client = clientList.find(c => c.id === id);
      if (client) {
        setName(client.name);
        setCompany(client.company || '');
        setEmail(client.email || '');
        setPhone(client.phone || '');
        setAddress(client.address || '');
      }
    }
  }

  async function save() {
    await projects.update(project.id, {
      client_id: selectedClientId || null,
      client_name: name || null, client_company: company || null,
      client_email: email || null, client_phone: phone || null, client_address: address || null,
    });
    setEditing(false);
    onSaved();
  }

  const hasData = project.client_name || project.client_email || project.client_phone || project.client_company || project.client_address;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title">Kundendaten</h2>
        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost text-sm">Abbrechen</button>
            <button onClick={save} className="btn-primary text-sm">Speichern</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="btn-ghost text-sm"><Pencil size={14} /> Bearbeiten</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-4">
          <Field label="Kundin auswählen" hint="Oder unten manuell eintragen">
            <select
              className="input"
              value={selectedClientId}
              onChange={(e) => selectClient(e.target.value)}
            >
              <option value="">— Manuell eintragen —</option>
              {clientList.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.company ? ` (${c.company})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"><input className="input" value={name} onChange={(e) => { setSelectedClientId(''); setName(e.target.value); }} placeholder="Kundin Name" /></Field>
            <Field label="Firma"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            <Field label="E-Mail"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" /></Field>
            <Field label="Telefon"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Adresse"><textarea className="input min-h-[60px] resize-y" value={address} onChange={(e) => setAddress(e.target.value)} /></Field></div>
          </div>
        </div>
      ) : hasData ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {project.client_name && <div><p className="text-2xs text-ink-400">Name</p><p className="text-ink-900">{project.client_name}</p></div>}
          {project.client_company && <div><p className="text-2xs text-ink-400">Firma</p><p className="text-ink-900">{project.client_company}</p></div>}
          {project.client_email && <div><p className="text-2xs text-ink-400">E-Mail</p><a href={`mailto:${project.client_email}`} className="text-accent-600 hover:underline">{project.client_email}</a></div>}
          {project.client_phone && <div><p className="text-2xs text-ink-400">Telefon</p><p className="text-ink-900">{project.client_phone}</p></div>}
          {project.client_address && <div className="sm:col-span-2"><p className="text-2xs text-ink-400">Adresse</p><p className="text-ink-900 whitespace-pre-line">{project.client_address}</p></div>}
        </div>
      ) : (
        <p className="text-sm text-ink-400">Keine Kundendaten erfasst. Klick auf Bearbeiten um welche hinzuzufügen.</p>
      )}
    </div>
  );
}

function AssetPanel({ assets, onAdd, onRemove }: {
  assets: ProjectAsset[];
  onAdd: (type: ProjectAsset['type'], label: string, value: string, fileMeta?: { name: string; mime: string; size: number }) => void;
  onRemove: (id: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<ProjectAsset['type']>('link');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; mime: string; size: number } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<ProjectAsset | null>(null);

  async function pickFile() {
    const studio = (window as unknown as { studio?: { file?: { pick: () => Promise<{ ok: boolean; name?: string; mime?: string; size_bytes?: number; data_base64?: string }> } } }).studio;
    if (!studio?.file?.pick) {
      alert('Datei-Upload ist nur in der Desktop-App verfügbar.');
      return;
    }
    setUploading(true);
    try {
      const res = await studio.file.pick();
      if (!res.ok || !res.data_base64) return;
      setLabel(res.name || 'Datei');
      setValue(res.data_base64);
      setType('file');
      setFileMeta({ name: res.name || 'Datei', mime: res.mime || '', size: res.size_bytes || 0 });
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (type === 'file' && value && fileMeta) {
      onAdd('file', label, value, fileMeta);
    } else {
      onAdd(type, label, value);
    }
    setLabel(''); setValue(''); setShowAdd(false); setType('link'); setFileMeta(null);
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isImage(mime: string | null): boolean {
    return mime?.startsWith('image/') ?? false;
  }

  function isPreviewable(mime: string | null): boolean {
    if (!mime) return false;
    return mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/');
  }

  function downloadFile(a: ProjectAsset) {
    const link = document.createElement('a');
    
    if (a.type === 'note') {
      // Notizen als .txt downloaden
      link.href = `data:text/plain;base64,${a.value}`;
      link.download = `${a.label}.txt`;
    } else {
      // Dateien mit originalem MIME-Type
      link.href = `data:${a.file_mime || 'application/octet-stream'};base64,${a.value}`;
      link.download = a.file_name || a.label;
    }
    link.click();
  }

  function getFileIcon(mime: string | null) {
    if (isImage(mime)) return <Image size={16} className="text-accent-600" />;
    if (mime?.startsWith('video/')) return <FileText size={16} className="text-ink-400" />;
    if (mime?.includes('pdf')) return <FileText size={16} className="text-danger-500" />;
    return <FileText size={16} className="text-ink-400" />;
  }

  return (
    <>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Assets</h2>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-sm"><Plus size={14} /> Hinzufügen</button>
        </div>
        {showAdd && (
          <div className="mb-3 p-3 rounded-lg bg-surfaceAlt/50 space-y-2">
            <div className="flex gap-2">
              <button onClick={() => setType('link')} className={`chip ${type === 'link' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Link</button>
              <button onClick={() => setType('note')} className={`chip ${type === 'note' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Notiz</button>
              <button onClick={pickFile} className={`chip ${type === 'file' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>
                {uploading ? 'Lädt…' : 'Datei hochladen'}
              </button>
            </div>
            <input className="input" placeholder="Bezeichnung" value={label} onChange={(e) => setLabel(e.target.value)} />
            {type === 'link' && (
              <input className="input" placeholder="https://…" value={value} onChange={(e) => setValue(e.target.value)} />
            )}
            {type === 'note' && (
              <textarea className="input min-h-[60px] resize-y" placeholder="Notiztext…" value={value} onChange={(e) => setValue(e.target.value)} />
            )}
            {type === 'file' && value && fileMeta && (
              <div className="space-y-2">
                {isImage(fileMeta.mime) && (
                  <div className="rounded-lg overflow-hidden bg-surfaceAlt">
                    <img
                      src={`data:${fileMeta.mime};base64,${value}`}
                      alt="Vorschau"
                      className="max-h-40 mx-auto object-contain"
                    />
                  </div>
                )}
                <p className="text-2xs text-success-600">
                  {fileMeta.name} ({formatSize(fileMeta.size)}) — Klick auf Speichern.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={submit} className="btn-primary text-sm" disabled={!label.trim() || !value.trim()}>Speichern</button>
              <button onClick={() => { setShowAdd(false); setLabel(''); setValue(''); setType('link'); setFileMeta(null); }} className="btn-ghost text-sm">Abbrechen</button>
            </div>
          </div>
        )}
        {assets.length === 0 && !showAdd ? (
          <EmptyState icon={<FileText size={22} />} title="Keine Assets" hint="Füge Links, Notizen oder Dateien hinzu." />
        ) : (
          <div className="space-y-1">
            {assets.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surfaceAlt group">
                <div className="shrink-0 w-8 h-8 rounded bg-surfaceMuted flex items-center justify-center">
                  {a.type === 'link' ? <Link2 size={16} className="text-accent-600" /> : a.type === 'note' ? <FileText size={16} className="text-ink-400" /> : getFileIcon(a.file_mime)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{a.label}</p>
                  <p className="text-2xs text-ink-400 truncate">
                    {a.type === 'link' ? a.value : a.type === 'file' ? `${a.file_name || 'Datei'}${a.file_size ? ` · ${formatSize(a.file_size)}` : ''}` : a.value}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Link: nur öffnen Button, KEIN Eye-Icon */}
                  {a.type === 'link' && (
                    <a href={a.value} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-surfaceMuted text-accent-600 text-sm" title="Link öffnen">
                      Öffnen →
                    </a>
                  )}
                  
                  {/* File: Vorschau + Download */}
                  {a.type === 'file' && isPreviewable(a.file_mime) && (
                    <button onClick={() => setPreviewAsset(a)} className="p-1.5 rounded hover:bg-surfaceMuted text-accent-600" title="Vorschau">
                      <Eye size={14} />
                    </button>
                  )}
                  {a.type === 'file' && (
                    <button onClick={() => downloadFile(a)} className="p-1.5 rounded hover:bg-surfaceMuted text-ink-500" title="Download">
                      <Download size={14} />
                    </button>
                  )}
                  
                  {/* Note: Vorschau + Download (NEU!) */}
                  {a.type === 'note' && (
                    <>
                      <button onClick={() => setPreviewAsset(a)} className="p-1.5 rounded hover:bg-surfaceMuted text-accent-600" title="Vorschau">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => downloadFile(a)} className="p-1.5 rounded hover:bg-surfaceMuted text-ink-500" title="Download">
                        <Download size={14} />
                      </button>
                    </>
                  )}
                  
                  <button onClick={() => onRemove(a.id)} className="p-1.5 rounded hover:bg-danger-50 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox for preview */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/90 flex items-center justify-center p-4"
          onClick={() => setPreviewAsset(null)}
        >
          <button
            onClick={() => setPreviewAsset(null)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={24} />
          </button>
          {previewAsset.type === 'file' && isImage(previewAsset.file_mime) ? (
            <img
              src={`data:${previewAsset.file_mime};base64,${previewAsset.value}`}
              alt={previewAsset.label}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : previewAsset.type === 'file' && previewAsset.file_mime === 'application/pdf' ? (
            <iframe
              src={`data:${previewAsset.file_mime};base64,${previewAsset.value}`}
              className="w-full h-full max-w-4xl max-h-[80vh] rounded-lg bg-white"
              onClick={(e) => e.stopPropagation()}
              title={previewAsset.label}
            />
          ) : (
            <pre
              className="max-w-full max-h-full p-6 rounded-lg bg-white overflow-auto text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {previewAsset.type === 'note' ? previewAsset.value : atob(previewAsset.value)}
            </pre>
          )}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm flex items-center gap-4">
            <span>{previewAsset.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); downloadFile(previewAsset); }}
              className="flex items-center gap-1 text-white/80 hover:text-white"
            >
              <Download size={14} /> Download
            </button>
          </div>
        </div>
      )}
    </>
  );
}
// ---------------------------------------------------------------------------
// New project modal
// ---------------------------------------------------------------------------

function NewProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [clientList, setClientList] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [tplList, setTplList] = useState<PhaseTemplate[]>([]);
  const [tplItems, setTplItems] = useState<Record<string, { items: PhaseTemplateItem[]; checks: ChecklistTemplateItem[] }>>({});

  useEffect(() => {
    if (!open) return;
    (async () => {
      const tpls = await templates.list();
      setTplList(tpls);
      const map: Record<string, { items: PhaseTemplateItem[]; checks: ChecklistTemplateItem[] }> = {};
      for (const t of tpls) {
        const items = await templates.items(t.id);
        map[t.id] = { items, checks: [] };
      }
      setTplItems(map);
      const cls = await clients.list();
      setClientList(cls);
    })();
  }, [open]);

  function selectClient(id: string) {
    setSelectedClientId(id);
    if (id === '') {
      setClientName(''); setClientCompany(''); setClientEmail(''); setClientPhone(''); setClientAddress('');
    } else {
      const client = clientList.find(c => c.id === id);
      if (client) {
        setClientName(client.name);
        setClientCompany(client.company || '');
        setClientEmail(client.email || '');
        setClientPhone(client.phone || '');
        setClientAddress(client.address || '');
      }
    }
  }

  async function create() {
    if (!name.trim()) return;
    const id = await uuid();
    await projects.insert({
      id, name: name.trim(),
      client_id: selectedClientId || null,
      client_name: clientName.trim() || null,
      client_company: clientCompany.trim() || null,
      client_email: clientEmail.trim() || null,
      client_phone: clientPhone.trim() || null,
      client_address: clientAddress.trim() || null,
      template_id: templateId || null, status: 'active',
      start_date: startDate || null, target_end_date: endDate || null,
      actual_end_date: null, notes: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // Generate phase snapshots from template
    if (templateId && tplItems[templateId]) {
      const items = tplItems[templateId].items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const phaseId = await uuid();
        await phases.insert({
          id: phaseId, project_id: id, phase_template_item_id: it.id,
          name_override: it.name, status: 'open', deadline: null,
          completed_at: null, position_override: i,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
      }
    }
    setName(''); setSelectedClientId(''); setClientName(''); setClientCompany(''); setClientEmail(''); setClientPhone(''); setClientAddress('');
    setTemplateId(''); setEndDate('');
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Projekt" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={create} className="btn-primary" disabled={!name.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Projektname"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Website Relaunch Müller GmbH" autoFocus /></Field>
        <Field label="Kundin auswählen" hint="Oder unten manuell eintragen">
          <select className="input" value={selectedClientId} onChange={(e) => selectClient(e.target.value)}>
            <option value="">— Neue Kundin —</option>
            {clientList.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name"><input className="input" value={clientName} onChange={(e) => { setSelectedClientId(''); setClientName(e.target.value); }} placeholder="Kundin Name" /></Field>
          <Field label="Firma"><input className="input" value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} /></Field>
          <Field label="E-Mail"><input className="input" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="name@firma.de" /></Field>
          <Field label="Telefon"><input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></Field>
        </div>
        <Field label="Phasen-Vorlage" hint="Generiert Start-Phasen aus der Vorlage">
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">— Keine Vorlage —</option>
            {tplList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Startdatum"><input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Ziel-Ende"><input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
