import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, ChevronRight, Layers, ListChecks, Pencil, X, GripVertical,
} from 'lucide-react';
import { templates, uuid } from '../lib/db';
import type { PhaseTemplate, PhaseTemplateItem, ChecklistTemplateItem } from '../types';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

export function TemplatesView() {
  const [list, setList] = useState<PhaseTemplate[]>([]);
  const [selected, setSelected] = useState<PhaseTemplate | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setList(await templates.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    return <TemplateDetail template={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Phasen-Vorlagen</h1>
          <p className="text-sm text-ink-500 mt-0.5">
            Wiederverwendbare Phasen-Strukturen für neue Projekte
          </p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={16} /> Neue Vorlage
        </button>
      </div>

      <div className="card p-5">
        <SectionHeader title="Alle Vorlagen" />
        {list.length === 0 ? (
          <EmptyState
            icon={<Layers size={28} />}
            title="Keine Vorlagen"
            hint="Lege eine Vorlage an, um beim Erstellen neuer Projekte vorgefertigte Phasen zu generieren."
            action={<button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} /> Neue Vorlage</button>}
          />
        ) : (
          <div className="space-y-2">
            {list.map(t => (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-surfaceAlt transition-colors text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center">
                  <Layers size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">{t.name}</p>
                  <p className="text-2xs text-ink-500 truncate">{t.description || 'Keine Beschreibung'}</p>
                </div>
                {t.is_system ? <Badge tone="neutral">System</Badge> : <Badge tone="accent">Eigene</Badge>}
                <ChevronRight size={16} className="text-ink-400 group-hover:text-ink-700" />
              </button>
            ))}
          </div>
        )}
      </div>

      <NewTemplateModal open={showNew} onClose={() => setShowNew(false)} onCreated={load} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view — manage phases + checklist items of one template
// ---------------------------------------------------------------------------

function TemplateDetail({ template, onBack }: { template: PhaseTemplate; onBack: () => void }) {
  const [items, setItems] = useState<PhaseTemplateItem[]>([]);
  const [checks, setChecks] = useState<Record<string, ChecklistTemplateItem[]>>({});
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseDesc, setNewPhaseDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const its = await templates.items(template.id);
    setItems(its);
    const map: Record<string, ChecklistTemplateItem[]> = {};
    for (const it of its) {
      map[it.id] = await templates.checklistItems(it.id);
    }
    setChecks(map);
  }, [template.id]);

  useEffect(() => { load(); }, [load]);

  async function saveMeta() {
    await templates.update(template.id, { name, description: description || null });
    setEditingName(false);
    onBack();
  }

  async function addPhase() {
    if (!newPhaseName.trim()) return;
    const id = await uuid();
    await templates.addItem({
      id, template_id: template.id,
      name: newPhaseName.trim(), description: newPhaseDesc.trim() || null,
      position: items.length, created_at: new Date().toISOString(),
    });
    setNewPhaseName(''); setNewPhaseDesc('');
    load();
  }

  async function removePhase(id: string) {
    await templates.removeItem(id);
    load();
  }

  async function addCheck(phaseId: string, label: string) {
    if (!label.trim()) return;
    const id = await uuid();
    await templates.addChecklistItem({
      id, phase_template_item_id: phaseId,
      label: label.trim(), position: (checks[phaseId] || []).length,
      created_at: new Date().toISOString(),
    });
    load();
  }

  async function removeCheck(id: string) {
    await templates.removeChecklistItem(id);
    load();
  }

  async function deleteTemplate() {
    await templates.remove(template.id);
    onBack();
  }

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="btn-ghost -ml-2 mb-2 text-sm">
          <X size={16} /> Zurück zur Liste
        </button>
        {editingName ? (
          <div className="space-y-2">
            <input className="input text-lg font-medium" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Beschreibung" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={saveMeta} className="btn-primary text-sm">Speichern</button>
              <button onClick={() => { setEditingName(false); setName(template.name); setDescription(template.description || ''); }} className="btn-ghost text-sm">Abbrechen</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-medium text-ink-900">{template.name}</h1>
              <p className="text-sm text-ink-500 mt-0.5">{template.description || 'Keine Beschreibung'}</p>
            </div>
            <div className="flex items-center gap-2">
              {!template.is_system && (
                <button onClick={() => setEditingName(true)} className="btn-outline"><Pencil size={14} /> Bearbeiten</button>
              )}
              {template.is_system ? (
                <Badge tone="neutral">System-Vorlage (nicht löschbar)</Badge>
              ) : confirmDelete ? (
                <button onClick={deleteTemplate} className="btn-danger"><Trash2 size={14} /> Wirklich löschen</button>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="btn-danger"><Trash2 size={14} /></button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Phases */}
      <div className="card p-5">
        <SectionHeader title="Phasen" />
        {items.length === 0 ? (
          <EmptyState title="Noch keine Phasen" hint="Füge die erste Phase hinzu." />
        ) : (
          <div className="space-y-3">
            {items.map((item, i) => (
              <PhaseEditor
                key={item.id}
                item={item}
                index={i}
                checks={checks[item.id] || []}
                onAddCheck={(label) => addCheck(item.id, label)}
                onRemoveCheck={removeCheck}
                onRemove={() => removePhase(item.id)}
              />
            ))}
          </div>
        )}
        <div className="mt-4 p-3 rounded-lg bg-surfaceAlt/50 space-y-2">
          <input
            className="input"
            placeholder="Neue Phase (z.B. 'Konzept')"
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPhase(); }}
          />
          <input
            className="input"
            placeholder="Beschreibung (optional)"
            value={newPhaseDesc}
            onChange={(e) => setNewPhaseDesc(e.target.value)}
          />
          <button onClick={addPhase} className="btn-outline"><Plus size={14} /> Phase hinzufügen</button>
        </div>
      </div>
    </div>
  );
}

function PhaseEditor({ item, index, checks, onAddCheck, onRemoveCheck, onRemove }: {
  item: PhaseTemplateItem;
  index: number;
  checks: ChecklistTemplateItem[];
  onAddCheck: (label: string) => void;
  onRemoveCheck: (id: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [newCheck, setNewCheck] = useState('');
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-surfaceAlt/40">
        <GripVertical size={14} className="text-ink-300" />
        <span className="text-2xs font-semibold text-ink-400 tabular-nums w-5">{index + 1}</span>
        <button onClick={() => setOpen(!open)} className="text-ink-400 hover:text-ink-700">
          <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">{item.name}</p>
          {item.description && <p className="text-2xs text-ink-500 truncate">{item.description}</p>}
        </div>
        {checks.length > 0 && (
          <span className="flex items-center gap-1 text-2xs text-ink-500">
            <ListChecks size={12} /> {checks.length}
          </span>
        )}
        <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600"><Trash2 size={14} /></button>
      </div>
      {open && (
        <div className="px-4 py-3 space-y-1.5">
          {checks.length === 0 && <p className="text-2xs text-ink-400 py-1">Keine Checklist-Items</p>}
          {checks.map(c => (
            <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surfaceAlt/60 group">
              <span className="w-1 h-1 rounded-full bg-accent-400" />
              <span className="text-sm text-ink-700 flex-1">{c.label}</span>
              <button onClick={() => onRemoveCheck(c.id)} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <input
              className="input flex-1 text-sm"
              placeholder="Checklist-Eintrag (z.B. 'Moodboard')…"
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

// ---------------------------------------------------------------------------

function NewTemplateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function create() {
    if (!name.trim()) return;
    const id = await uuid();
    await templates.insert({
      id, name: name.trim(), description: description.trim() || null,
      is_system: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    setName(''); setDescription('');
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Phasen-Vorlage" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={create} className="btn-primary" disabled={!name.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Wartungsvertrag" autoFocus /></Field>
        <Field label="Beschreibung"><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Wofür ist diese Vorlage?" /></Field>
        <p className="text-sm text-ink-500">
          Nach dem Erstellen kannst du Phasen und Checklist-Items hinzufügen.
          Beim Anlegen eines neuen Projekts kannst du diese Vorlage auswählen — die Phasen werden dann als Startpunkt ins Projekt kopiert.
        </p>
      </div>
    </Modal>
  );
}
