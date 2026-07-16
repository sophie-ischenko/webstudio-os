import { useEffect, useState, useCallback } from 'react';
import {
  Plus, FileText, Trash2, Pencil, Download, Send, CheckCircle, Archive, XCircle,
  FolderOpen, Users, FolderKanban, Eye, Image, X
} from 'lucide-react';
import type { Document, DocumentType, DocumentStatus, Client, Project } from '../types';
import { documents, clients, projects, uuid } from '../lib/db';
import { formatDate, todayISO } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';

const TYPE_LABELS: Record<DocumentType, string> = {
  contract: 'Vertrag', avv: 'AVV', offer: 'Angebot', other: 'Sonstiges',
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Entwurf', sent: 'Versendet', signed: 'Unterzeichnet', archived: 'Archiviert', cancelled: 'Storniert',
};

const STATUS_TONE: Record<DocumentStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', sent: 'info', signed: 'success', archived: 'warning', cancelled: 'danger',
};

const STATUS_ORDER: DocumentStatus[] = ['draft', 'sent', 'signed', 'archived', 'cancelled'];

// --- Hilfsfunktionen für Dateien ---
function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string | null | undefined): boolean {
  return mime?.startsWith('image/') ?? false;
}

function isPreviewable(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/');
}

function getFileIcon(mime: string | null | undefined) {
  if (isImage(mime)) return <Image size={16} className="text-accent-600" />;
  if (mime?.startsWith('video/')) return <FileText size={16} className="text-ink-400" />;
  if (mime?.includes('pdf')) return <FileText size={16} className="text-danger-500" />;
  return <FileText size={16} className="text-ink-500" />;
}

function downloadDocument(doc: Document) {
  // Nimmt file_data (Base64), fallback auf file_path falls du das Feld so genannt hast
  const base64Data = (doc as any).file_data || doc.file_path;
  if (!base64Data) return;
  
  const link = document.createElement('a');
  link.href = `data:${(doc as any).file_mime || 'application/octet-stream'};base64,${base64Data}`;
  link.download = doc.file_name || doc.title;
  link.click();
}

export function DocumentsView() {
  const [list, setList] = useState<Document[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'all' | DocumentStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | DocumentType>('all');
  const [entityFilter, setEntityFilter] = useState<'all' | 'client' | 'project' | 'general'>('all');
  
  // Zustand für die Vorschau-Lightbox
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  const load = useCallback(async () => {
    setList(await documents.list());
    setClientList(await clients.list());
    setProjectList(await projects.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  let filtered = list;
  if (filter !== 'all') filtered = filtered.filter(d => d.status === filter);
  if (typeFilter !== 'all') filtered = filtered.filter(d => d.document_type === typeFilter);
  if (entityFilter !== 'all') {
    if (entityFilter === 'general') {
      filtered = filtered.filter(d => d.entity_type === 'general' || !d.entity_id);
    } else {
      filtered = filtered.filter(d => d.entity_type === entityFilter);
    }
  }

  const byStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = list.filter(d => d.status === s);
    return acc;
  }, {} as Record<DocumentStatus, Document[]>);

  async function updateStatus(id: string, status: DocumentStatus) {
    await documents.update(id, { status } as Partial<Document>);
    load();
  }

  async function remove(id: string) {
    if (confirm('Dokument wirklich löschen?')) {
      await documents.remove(id);
      load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Dokumentenarchiv</h1>
          <p className="text-sm text-ink-500 mt-0.5">Rechtlich relevante Dokumente verwalten</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Neues Dokument
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STATUS_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setFilter(filter === s ? 'all' : s)}
            className={`card p-3 text-left transition-all ${filter === s ? 'ring-2 ring-accent-500' : ''}`}
          >
            <p className="text-2xs font-medium text-ink-500">{STATUS_LABELS[s]}</p>
            <p className="text-lg font-semibold text-ink-900">{byStatus[s].length}</p>
          </button>
        ))}
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-2">
          {(['all', 'client', 'project', 'general'] as const).map(e => (
            <button
              key={e}
              onClick={() => setEntityFilter(e)}
              className={`chip transition-colors ${entityFilter === e ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
            >
              {e === 'all' ? 'Alle' : e === 'client' ? 'Kunden' : e === 'project' ? 'Projekte' : 'Allgemein'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['all', 'contract', 'avv', 'offer', 'other'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`chip transition-colors ${typeFilter === t ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
            >
              {t === 'all' ? 'Alle Typen' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="card p-5">
        <SectionHeader title={filter === 'all' ? 'Alle Dokumente' : STATUS_LABELS[filter]} />
        {filtered.length === 0 ? (
          <EmptyState icon={<FolderOpen size={24} />} title="Keine Dokumente" hint="Füge ein neues Dokument hinzu." />
        ) : (
          <div className="divide-y divide-line">
            {filtered.map(doc => (
              <DocumentRow
                key={doc.id}
                document={doc}
                onStatusChange={(status) => updateStatus(doc.id, status)}
                onRemove={() => remove(doc.id)}
                onEdit={load}
                onPreview={() => setPreviewDoc(doc)}
              />
            ))}
          </div>
        )}
      </div>

      <AddDocumentModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        clients={clientList}
        projects={projectList}
        onCreated={load}
      />

      {/* Lightbox for preview */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/90 flex items-center justify-center p-4"
          onClick={() => setPreviewDoc(null)}
        >
          <button
            onClick={() => setPreviewDoc(null)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={24} />
          </button>
          
          {(previewDoc as any).file_mime && isImage((previewDoc as any).file_mime) ? (
            <img
              src={`data:${(previewDoc as any).file_mime};base64,${(previewDoc as any).file_data || previewDoc.file_path}`}
              alt={previewDoc.title}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (previewDoc as any).file_mime === 'application/pdf' ? (
            <iframe
              src={`data:${(previewDoc as any).file_mime};base64,${(previewDoc as any).file_data || previewDoc.file_path}`}
              className="w-full h-full max-w-4xl max-h-[80vh] rounded-lg bg-white"
              onClick={(e) => e.stopPropagation()}
              title={previewDoc.title}
            />
          ) : (
            <pre
              className="max-w-full max-h-full p-6 rounded-lg bg-white overflow-auto text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {atob((previewDoc as any).file_data || previewDoc.file_path || '')}
            </pre>
          )}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm flex items-center gap-4">
            <span>{previewDoc.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); downloadDocument(previewDoc); }}
              className="flex items-center gap-1 text-white/80 hover:text-white"
            >
              <Download size={14} /> Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentRow({ document, onStatusChange, onRemove, onEdit, onPreview }: {
  document: Document;
  onStatusChange: (status: DocumentStatus) => void;
  onRemove: () => void;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const nextStatus: Record<DocumentStatus, DocumentStatus | null> = {
    draft: 'sent', sent: 'signed', signed: 'archived', archived: null, cancelled: null,
  };

  const nextActionLabel: Record<DocumentStatus, string | null> = {
    draft: 'Versenden', sent: 'Unterzeichnen', signed: 'Archivieren', archived: null, cancelled: null,
  };

  const hasFile = !!((document as any).file_data || document.file_path);
  const mime = (document as any).file_mime;

  return (
    <>
      <div className="flex items-center gap-3 py-3 group">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-surfaceMuted text-ink-500">
          {hasFile ? getFileIcon(mime) : (document.entity_type === 'client' ? <Users size={16} /> : document.entity_type === 'project' ? <FolderKanban size={16} /> : <FolderOpen size={16} />)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{document.title}</p>
          <p className="text-2xs text-ink-500 truncate">
            <span className="inline-block px-1.5 py-0.5 rounded bg-surfaceAlt text-ink-600 mr-1">{TYPE_LABELS[document.document_type]}</span>
            {document.entity_name}
            {document.version && ` · v${document.version}`}
            {hasFile && ` · ${document.file_name} ${formatSize((document as any).file_size)}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[document.status]}>{STATUS_LABELS[document.status]}</Badge>
        <div className="flex items-center gap-1">
          {nextStatus[document.status] && (
            <button
              onClick={() => onStatusChange(nextStatus[document.status]!)}
              className="btn-ghost text-2xs px-2 py-1"
              title={nextActionLabel[document.status]!}
            >
              {document.status === 'draft' && <Send size={13} />}
              {document.status === 'sent' && <CheckCircle size={13} />}
              {document.status === 'signed' && <Archive size={13} />}
            </button>
          )}

          {/* Neue Buttons für Vorschau & Download */}
          {hasFile && isPreviewable(mime) && (
            <button onClick={onPreview} className="p-1 text-accent-600 hover:text-accent-700 opacity-0 group-hover:opacity-100" title="Vorschau">
              <Eye size={14} />
            </button>
          )}
          {hasFile && (
            <button onClick={() => downloadDocument(document)} className="p-1 text-ink-400 hover:text-ink-600 opacity-0 group-hover:opacity-100" title="Download">
              <Download size={14} />
            </button>
          )}

          <button onClick={() => setEditing(true)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100">
            <Pencil size={14} />
          </button>
          <button onClick={onRemove} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <EditDocumentModal
          document={document}
          onClose={() => setEditing(false)}
          onSaved={() => { onEdit(); setEditing(false); }}
        />
      )}
    </>
  );
}

function AddDocumentModal({ open, onClose, clients, projects, onCreated }: {
  open: boolean;
  onClose: () => void;
  clients: Client[];
  projects: Project[];
  onCreated: () => void;
}) {
  const [entityType, setEntityType] = useState<Document['entity_type']>('general');
  const [entityId, setEntityId] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('contract');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<DocumentStatus>('draft');
  const [notes, setNotes] = useState('');

  // Datei-Upload States
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; mime: string; size: number; data: string } | null>(null);

  const entityOptions = entityType === 'client' ? clients : projects;
  const entityName = !entityId ? 'Allgemein' :
    (entityType === 'client' ? clients.find(c => c.id === entityId)?.name : projects.find(p => p.id === entityId)?.name) || '';

  async function pickFile() {
    const studio = (window as any).studio;
    if (!studio?.file?.pick) {
      alert('Datei-Upload ist nur in der Desktop-App verfügbar.');
      return;
    }
    setUploading(true);
    try {
      const res = await studio.file.pick();
      if (!res.ok || !res.data_base64) return;
      setFileMeta({
        name: res.name || 'Datei',
        mime: res.mime || '',
        size: res.size_bytes || 0,
        data: res.data_base64
      });
      // Wenn der Titel leer ist, nimm den Dateinamen
      if (!title) {
        setTitle(res.name?.split('.')[0] || 'Neues Dokument');
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!title.trim()) return;

    const id = await uuid();
    await documents.insert({
      id,
      entity_type: entityType,
      entity_id: entityId || null,
      entity_name: entityName,
      document_type: documentType,
      title: title.trim(),
      version: version.trim() || null,
      status,
      // Datei-Eigenschaften speichern
      file_name: fileMeta?.name || null,
      file_path: null, // oder fileMeta?.data falls du die Base64 direkt in `file_path` speicherst
      file_data: fileMeta?.data || null,
      file_mime: fileMeta?.mime || null,
      file_size: fileMeta?.size || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any); // Cast zu any, falls TS die neuen File-Felder noch nicht kennt

    setEntityType('general'); setEntityId(''); setTitle(''); setVersion(''); setNotes(''); setFileMeta(null);
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Dokument" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={submit} className="btn-primary" disabled={!title.trim()}>Erstellen</button></>}
    >
      <div className="space-y-4">
        
        {/* Datei Upload Button */}
        <div className="p-4 border border-dashed border-line rounded-lg bg-surfaceAlt/50 text-center">
          {fileMeta ? (
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-success-600">
                <CheckCircle size={16} />
                <span className="font-medium truncate max-w-[200px]">{fileMeta.name}</span>
                <span className="text-2xs text-ink-500">({formatSize(fileMeta.size)})</span>
              </div>
              <button onClick={() => setFileMeta(null)} className="text-ink-400 hover:text-danger-500"><Trash2 size={16} /></button>
            </div>
          ) : (
            <button onClick={pickFile} className="btn-outline w-full justify-center">
              {uploading ? 'Lädt...' : <><Plus size={16} /> PDF oder Datei hochladen</>}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Zuordnung">
            <select className="input" value={entityType} onChange={(e) => { setEntityType(e.target.value as Document['entity_type']); setEntityId(''); }}>
              <option value="general">Allgemein</option>
              <option value="client">Kunde</option>
              <option value="project">Projekt</option>
            </select>
          </Field>
          {(entityType === 'client' || entityType === 'project') && (
            <Field label={entityType === 'client' ? 'Kunde' : 'Projekt'}>
              <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">— Bitte wählen —</option>
                {entityOptions.map(e => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Typ">
            <select className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
              <option value="contract">Vertrag</option>
              <option value="avv">AVV</option>
              <option value="offer">Angebot</option>
              <option value="other">Sonstiges</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus)}>
              <option value="draft">Entwurf</option>
              <option value="sent">Versendet</option>
              <option value="signed">Unterzeichnet</option>
              <option value="archived">Archiviert</option>
            </select>
          </Field>
        </div>

        <Field label="Titel">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Rahmenvertrag 2024" />
        </Field>

        <Field label="Version (optional)">
          <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="z.B. 1.0" />
        </Field>

        <Field label="Notizen (optional)">
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function EditDocumentModal({ document, onClose, onSaved }: { document: Document; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(document.title);
  const [documentType, setDocumentType] = useState<DocumentType>(document.document_type);
  const [version, setVersion] = useState(document.version || '');
  const [status, setStatus] = useState<DocumentStatus>(document.status);
  const [notes, setNotes] = useState(document.notes || '');

  function save() {
    documents.update(document.id, {
      title: title.trim(),
      document_type: documentType,
      version: version.trim() || null,
      status,
      notes: notes.trim() || null,
    });
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Dokument bearbeiten" size="md"
      footer={<><button onClick={onClose} className="btn-ghost">Abbrechen</button><button onClick={save} className="btn-primary">Speichern</button></>}
    >
      <div className="space-y-4">
        <Field label="Titel"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Typ">
            <select className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
              <option value="contract">Vertrag</option>
              <option value="avv">AVV</option>
              <option value="offer">Angebot</option>
              <option value="other">Sonstiges</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus)}>
              <option value="draft">Entwurf</option>
              <option value="sent">Versendet</option>
              <option value="signed">Unterzeichnet</option>
              <option value="archived">Archiviert</option>
              <option value="cancelled">Storniert</option>
            </select>
          </Field>
        </div>
        <Field label="Version"><input className="input" value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
        <Field label="Notizen"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      </div>
    </Modal>
  );
}