import { useEffect, useState, useRef } from 'react';
import { 
  Search, FolderKanban, Users, CheckSquare, StickyNote, FileText, Calendar, Target, Building2, X 
} from 'lucide-react';
import { projects, clients, todos, notes, invoices, posts, offers, documents, suppliers } from '../lib/db';
import type { ViewId } from './Sidebar';

interface GlobalSearchProps {
  onNavigate: (view: ViewId) => void;
}

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  type: 'project' | 'client' | 'task' | 'note' | 'invoice' | 'offer' | 'document' | 'post' | 'supplier';
  viewId: ViewId;
}

export function GlobalSearch({ onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Suchpools
  const [projectData, setProjectData] = useState<any[]>([]);
  const [clientData, setClientData] = useState<any[]>([]);
  const [taskData, setTaskData] = useState<any[]>([]);
  const [noteData, setNoteData] = useState<any[]>([]);
  const [invoiceData, setInvoiceData] = useState<any[]>([]);
  const [offerData, setOfferData] = useState<any[]>([]);
  const [documentData, setDocumentData] = useState<any[]>([]);
  const [postData, setPostData] = useState<any[]>([]);
  const [supplierData, setSupplierData] = useState<any[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Globaler Shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Suchdaten laden sobald das Suchfeld fokussiert wird oder geöffnet ist
  const loadSearchData = async () => {
    try {
      const [p, c, t, n, i, o, d, pst, s] = await Promise.all([
        projects.list().catch(() => []),
        clients.list().catch(() => []),
        todos.list().catch(() => []),
        notes.list().catch(() => []),
        invoices.list().catch(() => []),
        offers.list().catch(() => []),
        documents.list().catch(() => []),
        posts.list().catch(() => []),
        suppliers.list().catch(() => []),
      ]);
      setProjectData(p);
      setClientData(c);
      setTaskData(t);
      setNoteData(n);
      setInvoiceData(i);
      setOfferData(o);
      setDocumentData(d);
      setPostData(pst);
      setSupplierData(s);
    } catch (err) {
      console.error('Fehler beim Laden des Suchpools:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSearchData();
    }
  }, [isOpen]);

  // Schließen bei Klick außerhalb des Suchfelds
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter-Logik
  const results: SearchResult[] = [];
  const q = query.trim().toLowerCase();

  if (q.length > 0) {
    // 1. Projekte
    projectData.forEach(p => {
      if (p.name.toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q)) {
        results.push({ id: p.id, title: p.name, subtitle: p.client_name || 'Projekt', type: 'project', viewId: 'projects' });
      }
    });

    // 2. Kunden (CRM)
    clientData.forEach(c => {
      if (c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q)) {
        results.push({ id: c.id, title: c.name, subtitle: c.company || 'Kunde', type: 'client', viewId: 'clients' });
      }
    });

    // 3. Rechnungen
    invoiceData.forEach(i => {
      if ((i.invoice_number || '').toLowerCase().includes(q) || (i.client_name || '').toLowerCase().includes(q)) {
        results.push({ id: i.id, title: i.invoice_number || 'Rechnung', subtitle: i.client_name, type: 'invoice', viewId: 'invoices' });
      }
    });

    // 4. Angebote
    offerData.forEach(o => {
      if (o.title.toLowerCase().includes(q) || (o.client_name || '').toLowerCase().includes(q)) {
        results.push({ id: o.id, title: o.title, subtitle: `${o.client_name} · ${o.status}`, type: 'offer', viewId: 'finances' });
      }
    });

    // 5. Aufgaben
    taskData.forEach(t => {
      if (t.title.toLowerCase().includes(q)) {
        results.push({ id: t.id, title: t.title, subtitle: t.status === 'done' ? 'Erledigt' : 'Offen', type: 'task', viewId: 'todos' });
      }
    });

    // 6. Notizen
    noteData.forEach(n => {
      if (n.title.toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q)) {
        results.push({ id: n.id, title: n.title, subtitle: n.category || 'Notiz', type: 'note', viewId: 'notes' });
      }
    });

    // 7. Dokumente
    documentData.forEach(d => {
      if (d.title.toLowerCase().includes(q)) {
        results.push({ id: d.id, title: d.title, subtitle: d.document_type || 'Archiv', type: 'document', viewId: 'documents' });
      }
    });

    // 8. Social Posts
    postData.forEach(p => {
      if ((p.topic || '').toLowerCase().includes(q) || (p.caption || '').toLowerCase().includes(q)) {
        results.push({ id: p.id, title: p.topic || 'Social Post', subtitle: p.platform, type: 'post', viewId: 'social' });
      }
    });

    // 9. Tool-Abos
    supplierData.forEach(s => {
      if (s.name.toLowerCase().includes(q)) {
        results.push({ id: s.id, title: s.name, subtitle: 'Abo / Tool', type: 'supplier', viewId: 'suppliers' });
      }
    });
  }

  // Schneide die Ergebnisse auf maximal 15 ab
  const limitedResults = results.slice(0, 15);

  // Wenn sich der Suchbegriff ändert, Auswahl-Index zurücksetzen
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  // Tastatursteuerung
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || limitedResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < limitedResults.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && limitedResults[activeIndex]) {
        handleSelect(limitedResults[activeIndex].viewId);
      } else if (limitedResults.length > 0) {
        handleSelect(limitedResults[0].viewId);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  function handleSelect(viewId: ViewId) {
    onNavigate(viewId);
    setQuery('');
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  // OS Check für Hint
  const isMac = navigator.userAgent.includes('Mac');
  const shortcutHint = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative group">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 group-focus-within:text-accent-500 transition-colors" />
        <input
          ref={inputRef}
          className="w-full pl-9 pr-14 py-2 rounded-lg border border-line bg-surfaceAlt text-sm text-ink-900 placeholder:text-ink-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-400 transition-all"
          placeholder="Projekt, Rechnung, Aufgabe..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />
        
        {/* Shortcut Hint oder X-Button */}
        {!query && !isOpen && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-ink-400 border border-line bg-surface rounded px-1.5 py-0.5 pointer-events-none">
            {shortcutHint}
          </div>
        )}
        {query && (
          <button onClick={() => { setQuery(''); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
            <X size={14} />
          </button>
        )}
      </div>

      {isOpen && q.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 max-h-[360px] overflow-y-auto rounded-xl border border-line bg-surface shadow-pop z-50 py-1 animate-scale-in">
          {limitedResults.length === 0 ? (
            <div className="p-4 text-center text-ink-400 text-sm">Keine Ergebnisse gefunden</div>
          ) : (
            limitedResults.map((r, i) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => handleSelect(r.viewId)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors
                  ${activeIndex === i ? 'bg-accent-50' : 'hover:bg-surfaceAlt'}`}
              >
                <span className={`shrink-0 ${activeIndex === i ? 'text-accent-600' : 'text-ink-500'}`}>
                  {r.type === 'project' && <FolderKanban size={14} />}
                  {r.type === 'client' && <Users size={14} />}
                  {r.type === 'invoice' && <FileText size={14} />}
                  {r.type === 'offer' && <Target size={14} />}
                  {r.type === 'task' && <CheckSquare size={14} />}
                  {r.type === 'note' && <StickyNote size={14} />}
                  {r.type === 'document' && <FileText size={14} />}
                  {r.type === 'post' && <Calendar size={14} />}
                  {r.type === 'supplier' && <Building2 size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate font-medium ${activeIndex === i ? 'text-accent-900' : 'text-ink-900'}`}>{r.title}</p>
                  {r.subtitle && <p className="text-2xs text-ink-400 truncate">{r.subtitle}</p>}
                </div>
                <span className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase bg-surfaceMuted px-1.5 py-0.5 rounded">
                  {r.type}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}