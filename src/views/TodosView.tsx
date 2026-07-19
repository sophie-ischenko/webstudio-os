import { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Search, Trash2, Calendar, CheckSquare, Square, 
  Clock, Archive, ChevronLeft, ChevronRight, Tag, Filter
} from 'lucide-react';
import { todos, projects, posts, uuid, run, all } from '../lib/db';
import type { Todo, Project, SocialPost, TodoStatus, TodoPriority } from '../types';
import { formatDate, todayISO, relativeDeadline } from '../lib/format';
import { Badge, Field, EmptyState, Modal } from '../components/ui';

// Konstanten für Status und Prioritäten definieren
const STATUS_LABELS: Record<string, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
};

// Vordefinierte Standardkategorien zur Schnellauswahl
const PRESET_CATEGORIES = ['Arbeit', 'Privat', 'Finanzen', 'Einkauf', 'Haushalt'];

function getWeekKey(date: Date = new Date()): string {
  const tempDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tempDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tempDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function TodosView() {
  const [todoList, setTodoList] = useState<Todo[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [postList, setSocialPosts] = useState<SocialPost[]>([]);
  
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'done'>('open');
  const [categoryFilter, setCategoryFilter] = useState<string>('all'); // Filter für Kategorie
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);

  // Daten laden & Sicherheitsprüfung für die DB-Spalte ausführen
  const loadData = useCallback(async () => {
    // Frontend-Sicherheitscheck: Spalte 'category' anlegen, falls noch nicht geschehen
    const tableInfo = await all<any>("PRAGMA table_info(todos)").catch(() => []);
    const hasCol = tableInfo.some(c => c.name === 'category');
    if (!hasCol) {
      await run("ALTER TABLE todos ADD COLUMN category TEXT;").catch(() => {});
    }

    const [t, p, sp] = await Promise.all([
      todos.list(),
      projects.list(),
      posts.list()
    ]);
    setTodoList(t);
    setProjectList(p);
    setSocialPosts(sp);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + weekOffset * 7);
  const currentWeekKey = getWeekKey(targetDate);

  async function handleToggleTodo(todo: Todo) {
    const newStatus = todo.status === 'done' ? 'todo' : 'done';
    const completedAt = newStatus === 'done' ? new Date().toISOString() : null;
    await todos.update(todo.id, { status: newStatus, completed_at: completedAt });
    loadData();
  }

  async function handleDeleteTodo(id: string) {
    if (!confirm('Aufgabe wirklich löschen?')) return;
    await todos.remove(id);
    loadData();
  }

  async function handleSaveTodo(data: any) {
    if (editingTodo) {
      await todos.update(editingTodo.id, data);
    } else {
      const id = await uuid();
      await todos.insert({
        id,
        ...data,
        position: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    setShowAddModal(false);
    setEditingTodo(null);
    loadData();
  }

  // Alle aktuell genutzten Kategorien für den Filter extrahieren
  const activeCategories = Array.from(
    new Set(todoList.map(t => (t as any).category).filter(Boolean))
  ) as string[];

  // Filter- & Suchlogik
  const filteredTodos = todoList.filter(t => {
    const matchesSearch = 
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      ((t as any).category || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'open' && t.status !== 'done') || 
      (statusFilter === 'done' && t.status === 'done');

    const matchesCategory = categoryFilter === 'all' || (t as any).category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const weekTodos = filteredTodos.filter(t => t.week_key === currentWeekKey);
  const backlogTodos = filteredTodos.filter(t => !t.week_key && t.status !== 'done');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Aufgaben & To-dos</h1>
          <p className="text-sm text-ink-500 mt-0.5">Wochenplanung und backlog-übergreifende To-dos</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          <Plus size={14} /> Neue Aufgabe
        </button>
      </div>

      {/* Filter & Suche */}
      <div className="card p-4 flex flex-wrap gap-4 bg-surface items-center justify-between">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            type="text"
            placeholder="Aufgaben oder Kategorien durchsuchen..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        
        <div className="flex gap-2 items-center">
          {/* Kategorie-Filter */}
          <Filter size={14} className="text-ink-400" />
          <select 
            className="input !py-1.5 text-xs w-auto mr-2"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Alle Kategorien</option>
            {activeCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <button 
            onClick={() => setStatusFilter('open')} 
            className={`chip text-sm ${statusFilter === 'open' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}
          >
            Offen
          </button>
          <button 
            onClick={() => setStatusFilter('done')} 
            className={`chip text-sm ${statusFilter === 'done' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}
          >
            Erledigt
          </button>
          <button 
            onClick={() => setStatusFilter('all')} 
            className={`chip text-sm ${statusFilter === 'all' ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}
          >
            Alle
          </button>
        </div>
      </div>

      {/* Hauptbereich: Wochenfokus & Backlog */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* WOCHENFOKUS (2/3 Breite) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between p-1 bg-surfaceAlt/50 rounded-xl border border-line">
            <button onClick={() => setWeekOffset(w => w - 1)} className="p-1 hover:bg-surface rounded"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-ink-900 flex items-center gap-2">
              <Calendar size={14} className="text-accent-600" />
              Wochenfokus: {currentWeekKey}
            </span>
            <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 hover:bg-surface rounded"><ChevronRight size={16} /></button>
          </div>

          <div className="card p-4 space-y-3">
            {weekTodos.length === 0 ? (
              <EmptyState icon={<Calendar size={20} />} title="Keine Aufgaben für diese Woche" hint="Erstelle eine neue Aufgabe oder ziehe eine aus dem Backlog hierher." />
            ) : (
              <div className="divide-y divide-line">
                {weekTodos.map(todo => (
                  <TodoRow 
                    key={todo.id} 
                    todo={todo} 
                    projects={projectList} 
                    onToggle={handleToggleTodo} 
                    onEdit={(t) => { setEditingTodo(t); setShowAddModal(true); }}
                    onDelete={handleDeleteTodo}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* BACKLOG (1/3 Breite) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1 py-1.5">
            <Archive size={14} className="text-ink-500" />
            <h3 className="text-sm font-medium text-ink-900">Backlog (Ohne Woche)</h3>
          </div>

          <div className="card p-4 space-y-3 bg-surfaceAlt/20">
            {backlogTodos.length === 0 ? (
              <EmptyState icon={<Archive size={16} />} title="Kein Backlog" hint="Alle Aufgaben sind zeitlich geplant." />
            ) : (
              <div className="space-y-2">
                {backlogTodos.map(todo => (
                  <div 
                    key={todo.id} 
                    onClick={() => { setEditingTodo(todo); setShowAddModal(true); }}
                    // FIX: 'bg-white' durch das semantische, dark-mode-fähige 'bg-surface' ersetzt
                    className="p-3 bg-surface border border-line rounded-xl hover:border-accent-300 shadow-2xs transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 leading-snug truncate">{todo.title}</p>
                        {(todo as any).category && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-accent-700 bg-accent-50/50 px-1.5 py-0.5 rounded font-medium mt-1">
                            <Tag size={8} /> {(todo as any).category}
                          </span>
                        )}
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteTodo(todo.id); }}
                        className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {todo.project_id && (
                      <span className="inline-block mt-2 text-[10px] bg-surfaceAlt text-ink-600 px-1.5 py-0.5 rounded font-medium">
                        {projectList.find(p => p.id === todo.project_id)?.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Erstellen & Editieren Modal */}
      {showAddModal && (
        <TodoEditModal
          isOpen={showAddModal}
          onClose={() => { setShowAddModal(false); setEditingTodo(null); }}
          todo={editingTodo}
          projects={projectList}
          posts={postList}
          onSave={handleSaveTodo}
          currentWeekKey={currentWeekKey}
        />
      )}
    </div>
  );
}

// Einzelne Aufgabenzeile
function TodoRow({ todo, projects, onToggle, onEdit, onDelete }: any) {
  const project = projects.find((p: any) => p.id === todo.project_id);
  
  return (
    <div className="py-3 flex items-center justify-between group gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={() => onToggle(todo)} className="text-ink-400 hover:text-accent-600 shrink-0">
          {todo.status === 'done' ? (
            <CheckSquare size={18} className="text-success-600" />
          ) : (
            <Square size={18} />
          )}
        </button>
        <div className="min-w-0">
          <p className={`text-sm font-medium leading-snug ${todo.status === 'done' ? 'line-through text-ink-400' : 'text-ink-900'}`}>
            {todo.title}
          </p>
          {todo.description && <p className="text-xs text-ink-500 mt-0.5 truncate">{todo.description}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Kategorie-Badge */}
        {todo.category && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-medium bg-accent-50 text-accent-700">
            <Tag size={10} /> {todo.category}
          </span>
        )}
        {project && <Badge tone="info">{project.name}</Badge>}
        {todo.priority === 'high' && <Badge tone="danger">Hoch</Badge>}
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(todo)} className="p-1.5 hover:bg-surfaceMuted rounded text-ink-400 hover:text-ink-800">
            <Clock size={14} />
          </button>
          <button onClick={() => onDelete(todo.id)} className="p-1.5 hover:bg-surfaceMuted rounded text-ink-400 hover:text-danger-600">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Erfassen- / Editieren-Modal
function TodoEditModal({ isOpen, onClose, todo, projects, posts, onSave, currentWeekKey }: any) {
  const [title, setTitle] = useState(todo?.title || '');
  const [description, setDescription] = useState(todo?.description || '');
  const [status, setStatus] = useState(todo?.status || 'open');
  const [priority, setPriority] = useState(todo?.priority || 'normal');
  const [dueDate, setDueDate] = useState(todo?.due_date || '');
  const [weekKeyVal, setWeekKeyVal] = useState(todo?.week_key || '');
  const [projectId, setProjectId] = useState(todo?.project_id || '');
  const [socialPostId, setSocialPostId] = useState(todo?.social_post_id || '');
  const [category, setCategory] = useState(todo?.category || ''); // Neue Kategorie-State

  function submit() {
    if (!title.trim()) return alert('Titel erforderlich');
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      due_date: dueDate || null,
      week_key: weekKeyVal || null,
      project_id: projectId || null,
      social_post_id: socialPostId || null,
      category: category.trim() || null // Übergibt Kategorie
    });
  }

  return (
    <Modal open={isOpen} onClose={onClose} title={todo ? "Aufgabe bearbeiten" : "Neue Aufgabe"}>
      <div className="space-y-4">
        <Field label="Aufgabentitel *">
          <input 
            type="text" 
            className="input" 
            value={title} 
            onChange={e => setTitle(e.target.value)} 
            placeholder="z.B. Design-Schnittstellen fertigstellen"
          />
        </Field>

        <Field label="Beschreibung">
          <textarea 
            className="input min-h-[80px]" 
            value={description} 
            onChange={e => setDescription(e.target.value)} 
            placeholder="Details hinzufügen..."
          />
        </Field>

        {/* Kategorie & Priorität */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategorie (z.B. Arbeit, Privat)">
            <input 
              type="text" 
              className="input" 
              value={category} 
              onChange={e => setCategory(e.target.value)} 
              placeholder="z.B. Einkauf"
              list="category-presets" // Dropdown Vorschläge
            />
            <datalist id="category-presets">
              {PRESET_CATEGORIES.map(cat => <option key={cat} value={cat} />)}
            </datalist>
          </Field>
          <Field label="Priorität">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TodoPriority)}>
              {Object.keys(PRIORITY_LABELS).map(p => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Projekt">
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Kein Projekt —</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Fokus-Woche">
            <select className="input" value={weekKeyVal} onChange={e => setWeekKeyVal(e.target.value)}>
              <option value="">— Keine Woche (Backlog) —</option>
              <option value={currentWeekKey}>Diese Woche ({currentWeekKey})</option>
              <option value={getWeekKey(new Date(Date.now() + 7 * 86400000))}>Nächste Woche</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Social Post">
            <select className="input" value={socialPostId} onChange={(e) => setSocialPostId(e.target.value)}>
              <option value="">— Kein Post —</option>
              {posts.map((p: any) => <option key={p.id} value={p.id}>{p.topic || p.platform}</option>)}
            </select>
          </Field>
          <Field label="Fälligkeitsdatum">
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="flex gap-2 justify-end pt-3">
          <button onClick={onClose} className="btn-ghost">Abbrechen</button>
          <button onClick={submit} className="btn-primary">Speichern</button>
        </div>
      </div>
    </Modal>
  );
}