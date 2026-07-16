import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, StickyNote, Pin, Search, Copy, Check } from 'lucide-react';
import { notes, uuid } from '../lib/db';
import type { Note } from '../types';
import { formatDate } from '../lib/format';
import { Badge, EmptyState, Field, Modal } from '../components/ui';

const CATEGORY_LABELS: Record<string, string> = {
  snippet: 'Snippet', standard_answer: 'Standardantwort', knowledge: 'Wissen', general: 'Allgemein',
};
const CATEGORY_TONE: Record<string, 'neutral' | 'accent' | 'info' | 'warning'> = {
  snippet: 'accent', standard_answer: 'info', knowledge: 'warning', general: 'neutral',
};

export function NotesView() {
  const [list, setList] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => { setList(await notes.list()); }, []);
  useEffect(() => { load(); }, [load]);

  async function togglePin(n: Note) {
    await notes.update(n.id, { pinned: n.pinned ? 0 : 1 });
    load();
  }

  async function remove(id: string) {
    await notes.remove(id);
    load();
  }

  function copyContent(n: Note) {
    navigator.clipboard.writeText(n.content);
    setCopiedId(n.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const filtered = list.filter(n => {
    if (filterCat && n.category !== filterCat) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || (n.tags || '').toLowerCase().includes(q);
    }
    return true;
  });

  const categories = Array.from(new Set(list.map(n => n.category).filter(Boolean))) as string[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Notizen & Wissensbasis</h1>
          <p className="text-sm text-ink-500 mt-0.5">Snippets, Standardantworten, Wissen</p>
        </div>
        <button onClick={() => { setEditing(null); setShowAdd(true); }} className="btn-primary"><Plus size={16} /> Neue Notiz</button>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surfaceAlt text-sm" placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setFilterCat(null)} className={`chip text-2xs ${!filterCat ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>Alle</button>
          {categories.map(c => (
            <button key={c} onClick={() => setFilterCat(c)} className={`chip text-2xs ${filterCat === c ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700'}`}>
              {CATEGORY_LABELS[c] || c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8"><EmptyState icon={<StickyNote size={24} />} title="Keine Notizen" hint="Speichere Snippets, Standardantworten und Wissen hier." /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(n => (
            <div key={n.id} className={`card p-4 group hover:shadow-soft transition-shadow ${n.pinned ? 'ring-1 ring-accent-300' : ''}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {n.category && <Badge tone={CATEGORY_TONE[n.category] || 'neutral'}>{CATEGORY_LABELS[n.category] || n.category}</Badge>}
                  {n.pinned ? <Pin size={13} className="text-accent-600 fill-accent-600" /> : null}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => copyContent(n)} className="p-1 text-ink-400 hover:text-accent-600" title="Kopieren">
                    {copiedId === n.id ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
                  </button>
                  <button onClick={() => togglePin(n)} className={`p-1 ${n.pinned ? 'text-accent-600' : 'text-ink-400 hover:text-accent-600'}`}>
                    <Pin size={13} />
                  </button>
                  <button onClick={() => { setEditing(n); setShowAdd(true); }} className="p-1 text-ink-400 hover:text-ink-700 text-2xs">Bearb.</button>
                  <button onClick={() => remove(n.id)} className="p-1 text-ink-400 hover:text-danger-600">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="text-sm font-medium text-ink-900 mb-1">{n.title}</p>
              <p className="text-2xs text-ink-600 line-clamp-4 whitespace-pre-wrap">{n.content}</p>
              {n.tags && <p className="text-2xs text-ink-400 mt-2">#{n.tags.split(',').map(t => t.trim()).join(' #')}</p>}
              <p className="text-2xs text-ink-400 mt-2">{formatDate(n.updated_at)}</p>
            </div>
          ))}
        </div>
      )}

      {showAdd && <NoteModal existing={editing} onSaved={load} onClose={() => { setShowAdd(false); setEditing(null); }} />}
    </div>
  );
}

function NoteModal({ existing, onSaved, onClose }: { existing: Note | null; onSaved: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(existing?.title || '');
  const [content, setContent] = useState(existing?.content || '');
  const [category, setCategory] = useState(existing?.category || 'general');
  const [tags, setTags] = useState(existing?.tags || '');

  async function submit() {
    if (!title.trim() || !content.trim()) return;
    if (existing) {
      await notes.update(existing.id, { title: title.trim(), content: content.trim(), category, tags: tags.trim() || null });
    } else {
      const id = await uuid();
      await notes.insert({ id, title: title.trim(), content: content.trim(), category, tags: tags.trim() || null, pinned: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    setTitle(''); setContent(''); setTags('');
    onSaved();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={existing ? 'Notiz bearbeiten' : 'Neue Notiz'} size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary" disabled={!title.trim() || !content.trim()}>Speichern</button></>}
    >
      <div className="space-y-3">
        <Field label="Titel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Kategorie">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="general">Allgemein</option>
            <option value="snippet">Snippet</option>
            <option value="standard_answer">Standardantwort</option>
            <option value="knowledge">Wissen</option>
          </select>
        </Field>
        <Field label="Inhalt"><textarea className="input min-h-[160px] resize-y font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        <Field label="Tags (komma-separiert)"><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="z.B. css, responsive, grid" /></Field>
      </div>
    </Modal>
  );
}
