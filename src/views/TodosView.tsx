import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Check, ChevronLeft, ChevronRight, Link2, Calendar,
  Flag, Inbox, CheckSquare, Clock, Pencil,
} from 'lucide-react';
import { todos, projects, posts, uuid } from '../lib/db';
import type { Todo, Project, SocialPost, TodoStatus, TodoPriority } from '../types';
import { formatDate, isoWeek, startOfWeek, relativeDeadline } from '../lib/format';
import { Badge, EmptyState, Field, Modal } from '../components/ui';

const STATUS_LABELS: Record<TodoStatus, string> = {
  open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt',
};
const PRIORITY_LABELS: Record<TodoPriority, string> = {
  low: 'Niedrig', normal: 'Normal', high: 'Hoch',
};

function weekKeyHelper(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  const ws = startOfWeek(d);
  return `${ws.getFullYear()}-W${String(isoWeek(ws)).padStart(2, '0')}`;
}

function weekLabel(key: string): string {
  const [y, w] = key.split('-W');
  return `KW ${w} ${y}`;
}

export function TodosView() {
  const [weekList, setWeekList] = useState<Todo[]>([]);
  const [inboxList, setInboxList] = useState<Todo[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [postList, setPostList] = useState<SocialPost[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [filter, setFilter] = useState<'all' | TodoStatus>('all');

  const currentWeek = weekKeyHelper(weekOffset);
  const realCurrentWeek = weekKeyHelper(0);

  const load = useCallback(async () => {
    setWeekList(await todos.byWeek(currentWeek));
    setInboxList(await todos.unassigned());
    setProjectList(await projects.list());
    setPostList(await posts.list());
  }, [currentWeek]);

  useEffect(() => { load(); }, [load]);

  const filteredWeek = filter === 'all' ? weekList : weekList.filter(t => t.status === filter);
  const openCount = weekList.filter(t => t.status !== 'done').length;
  const doneCount = weekList.filter(t => t.status === 'done').length;

  async function cycleStatus(todo: Todo) {
    const next: TodoStatus = todo.status === 'open' ? 'in_progress' : todo.status === 'in_progress' ? 'done' : 'open';
    await todos.update(todo.id, {
      status: next,
      completed_at: next === 'done' ? new Date().toISOString() : null,
    });
    load();
  }

  async function setPriority(id: string, priority: TodoPriority) {
    await todos.update(id, { priority });
    load();
  }

  async function remove(id: string) {
    await todos.remove(id);
    load();
  }

  async function assignToWeek(id: string) {
    await todos.update(id, { week_key: currentWeek });
    load();
  }

  function projectLabel(t: Todo): string | null {
    if (t.project_id) {
      const p = projectList.find(p => p.id === t.project_id);
      return p?.name || null;
    }
    if (t.social_post_id) {
      const p = postList.find(p => p.id === t.social_post_id);
      return p ? `Social: ${p.topic || 'Unbenannt'}` : null;
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">To-dos</h1>
          <p className="text-sm text-ink-500 mt-0.5">Wochen-Listen + Inbox — projektunabhängig, optional verlinkbar</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Neue Aufgabe
        </button>
      </div>

      {/* Week view */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-accent-600" />
            <h2 className="section-title">{weekLabel(currentWeek)}</h2>
            <Badge tone="neutral">{openCount} offen</Badge>
            {doneCount > 0 && <Badge tone="success">{doneCount} erledigt</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset(o => o - 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronLeft size={18} /></button>
            <button onClick={() => setWeekOffset(0)} className="btn-ghost text-sm">Diese Woche</button>
            <button onClick={() => setWeekOffset(o => o + 1)} className="p-1.5 rounded-lg hover:bg-surfaceAlt"><ChevronRight size={18} /></button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {(['all', 'open', 'in_progress', 'done'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`chip transition-colors ${filter === f ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
            >
              {f === 'all' ? 'Alle' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>

        {filteredWeek.length === 0 ? (
          <EmptyState
            icon={<CheckSquare size={24} />}
            title="Keine To-dos in dieser Woche"
            hint="Füge Aufgaben hinzu oder weise Inbox-Items dieser Woche zu."
          />
        ) : (
          <div className="space-y-1.5">
            {filteredWeek.map(t => (
              <TodoRow
                key={t.id}
                todo={t}
                projectLabel={projectLabel(t)}
                onCycle={() => cycleStatus(t)}
                onPriority={(p) => setPriority(t.id, p)}
                onRemove={() => remove(t.id)}
                onEdit={() => setEditingTodo(t)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inbox */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Inbox size={18} className="text-ink-400" />
          <h2 className="section-title">Inbox</h2>
          <Badge tone="neutral">{inboxList.length} ohne Wochen-Zuordnung</Badge>
        </div>
        {inboxList.length === 0 ? (
          <EmptyState icon={<Inbox size={22} />} title="Inbox leer" hint="Neue Aufgaben ohne Wochen-Zuordnung landen hier." />
        ) : (
          <div className="space-y-1.5">
            {inboxList.map(t => (
              <TodoRow
                key={t.id}
                todo={t}
                projectLabel={projectLabel(t)}
                onCycle={() => cycleStatus(t)}
                onPriority={(p) => setPriority(t.id, p)}
                onRemove={() => remove(t.id)}
                onAssignWeek={() => assignToWeek(t.id)}
                onEdit={() => setEditingTodo(t)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddTodoModal
          open={true}
          onClose={() => setShowAdd(false)}
          onAdded={load}
          projects={projectList}
          posts={postList}
          defaultWeek={realCurrentWeek}
        />
      )}

      {editingTodo && (
        <EditTodoModal
          todo={editingTodo}
          open={true}
          onClose={() => setEditingTodo(null)}
          onSaved={() => { setEditingTodo(null); load(); }}
          projects={projectList}
          posts={postList}
        />
      )}
    </div>
  );
}

function TodoRow({ todo, projectLabel, onCycle, onPriority, onRemove, onAssignWeek, onEdit }: {
  todo: Todo;
  projectLabel: string | null;
  onCycle: () => void;
  onPriority: (p: TodoPriority) => void;
  onRemove: () => void;
  onAssignWeek?: () => void;
  onEdit: () => void;
}) {
  const isDone = todo.status === 'done';
  const dl = relativeDeadline(todo.due_date);
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg group ${isDone ? 'bg-surfaceAlt/20' : 'bg-surfaceAlt/40 hover:bg-surfaceAlt/60'}`}>
      <button
        onClick={onCycle}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
          ${isDone ? 'bg-success-500 border-success-500 text-white' : todo.status === 'in_progress' ? 'border-accent-500 bg-accent-50' : 'border-line hover:border-accent-300'}`}
      >
        {isDone ? <Check size={12} /> : todo.status === 'in_progress' ? <Clock size={11} className="text-accent-600" /> : null}
      </button>

      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isDone ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{todo.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {projectLabel && (
            <span className="flex items-center gap-1 text-2xs text-ink-500">
              <Link2 size={11} /> {projectLabel}
            </span>
          )}
          {todo.due_date && (
            <span className={`flex items-center gap-1 text-2xs ${dl.tone === 'overdue' ? 'text-danger-600' : dl.tone === 'soon' ? 'text-warning-600' : 'text-ink-400'}`}>
              <Calendar size={11} /> {formatDate(todo.due_date)}
            </span>
          )}
          {todo.status === 'in_progress' && <Badge tone="accent">In Arbeit</Badge>}
        </div>
      </div>

      <select
        value={todo.priority}
        onChange={(e) => onPriority(e.target.value as TodoPriority)}
        className="text-2xs bg-transparent border-0 text-ink-500 focus:outline-none cursor-pointer"
      >
        {(['low', 'normal', 'high'] as TodoPriority[]).map(p => (
          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
        ))}
      </select>

      {todo.priority === 'high' && <Flag size={13} className="text-danger-500" />}

      {onAssignWeek && (
        <button onClick={onAssignWeek} className="text-2xs text-accent-600 hover:underline px-2 py-1 rounded">
          → Woche
        </button>
      )}

      <button onClick={onEdit} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100" title="Bearbeiten">
        <Pencil size={14} />
      </button>
      <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100" title="Löschen">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddTodoModal({ open, onClose, onAdded, projects, posts, defaultWeek }: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  projects: Project[];
  posts: SocialPost[];
  defaultWeek: string;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignToWeek, setAssignToWeek] = useState(true);
  const [linkType, setLinkType] = useState<'none' | 'project' | 'social'>('none');
  const [projectId, setProjectId] = useState('');
  const [postId, setPostId] = useState('');

  async function submit() {
    if (!title.trim()) return;
    const id = await uuid();
    await todos.insert({
      id, title: title.trim(), description: description.trim() || null,
      status: 'open', priority,
      due_date: dueDate || null,
      week_key: assignToWeek ? defaultWeek : null,
      project_id: linkType === 'project' ? projectId || null : null,
      social_post_id: linkType === 'social' ? postId || null : null,
      position: 0, completed_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    setTitle(''); setDescription(''); setPriority('normal'); setDueDate(''); setProjectId(''); setPostId('');
    onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Aufgabe" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary" disabled={!title.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        <Field label="Aufgabe"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Landingpage für Projekt XY fertigstellen" autoFocus /></Field>
        <Field label="Beschreibung (optional)"><textarea className="input min-h-[60px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priorität">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
              {(['low', 'normal', 'high'] as TodoPriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </Field>
          <Field label="Fällig bis (optional)"><input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
          <input type="checkbox" checked={assignToWeek} onChange={(e) => setAssignToWeek(e.target.checked)} className="rounded" />
          Dieser Woche ({weekLabel(defaultWeek)}) zuordnen
        </label>

        <div>
          <p className="label">Verknüpfung (optional)</p>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setLinkType('none')} className={`chip ${linkType === 'none' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Keine</button>
            <button onClick={() => setLinkType('project')} className={`chip ${linkType === 'project' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Projekt</button>
            <button onClick={() => setLinkType('social')} className={`chip ${linkType === 'social' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Social Post</button>
          </div>
          {linkType === 'project' && (
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Projekt wählen —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {linkType === 'social' && (
            <select className="input" value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">— Post wählen —</option>
              {posts.map(p => <option key={p.id} value={p.id}>{p.topic || 'Unbenannt'} ({p.platform})</option>)}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
}

function EditTodoModal({
  todo,
  open,
  onClose,
  onSaved,
  projects,
  posts,
}: {
  todo: Todo;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  projects: Project[];
  posts: SocialPost[];
}) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description || '');
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [status, setStatus] = useState<TodoStatus>(todo.status);
  const [dueDate, setDueDate] = useState(todo.due_date || '');
  const [assignToWeek, setAssignToWeek] = useState(!!todo.week_key);
  const [weekKey, setWeekKeyState] = useState(todo.week_key || weekKeyHelper(0));
  const [linkType, setLinkType] = useState<'none' | 'project' | 'social'>(
    todo.project_id ? 'project' : todo.social_post_id ? 'social' : 'none'
  );
  const [projectId, setProjectId] = useState(todo.project_id || '');
  const [postId, setPostId] = useState(todo.social_post_id || '');

  async function submit() {
    if (!title.trim()) return;
    await todos.update(todo.id, {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      due_date: dueDate || null,
      week_key: assignToWeek ? weekKey : null,
      project_id: linkType === 'project' ? (projectId || null) : null,
      social_post_id: linkType === 'social' ? (postId || null) : null,
      updated_at: new Date().toISOString(),
    });
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aufgabe bearbeiten"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Abbrechen</button>
          <button onClick={submit} className="btn-primary" disabled={!title.trim()}>
            Speichern
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Aufgabe">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Beschreibung (optional)">
          <textarea className="input min-h-[60px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TodoStatus)}>
              <option value="open">Offen</option>
              <option value="in_progress">In Arbeit</option>
              <option value="done">Erledigt</option>
            </select>
          </Field>
          <Field label="Priorität">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
              <option value="low">Niedrig</option>
              <option value="normal">Normal</option>
              <option value="high">Hoch</option>
            </select>
          </Field>
          <Field label="Fällig bis">
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
          <input type="checkbox" checked={assignToWeek} onChange={(e) => setAssignToWeek(e.target.checked)} className="rounded" />
          Einer Woche zuordnen
        </label>
        {assignToWeek && (
          <Field label="Woche (Format: YYYY-WXX)">
            <input className="input" value={weekKey} onChange={(e) => setWeekKeyState(e.target.value)} />
          </Field>
        )}

        <div>
          <p className="label">Verknüpfung (optional)</p>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setLinkType('none')} className={`chip ${linkType === 'none' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Keine</button>
            <button onClick={() => setLinkType('project')} className={`chip ${linkType === 'project' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Projekt</button>
            <button onClick={() => setLinkType('social')} className={`chip ${linkType === 'social' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Social Post</button>
          </div>
          {linkType === 'project' && (
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Projekt wählen —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {linkType === 'social' && (
            <select className="input" value={postId} onChange={(e) => setPostId(e.target.value)}>
              <option value="">— Post wählen —</option>
              {posts.map(p => <option key={p.id} value={p.id}>{p.topic || 'Unbenannt'} ({p.platform})</option>)}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
}