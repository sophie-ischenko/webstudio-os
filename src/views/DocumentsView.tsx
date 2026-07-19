import { useEffect, useState, useCallback } from 'react';
import {
  Plus, FileText, Trash2, Pencil, Download, Send, CheckCircle, Archive, XCircle,
  FolderOpen, Users, FolderKanban, Eye, Image, X, Wallet
} from 'lucide-react';
import type { Document, DocumentType, DocumentStatus, Client, Project, Invoice, InvoicePosition } from '../types';
import { documents, clients, projects, invoices, settings, uuid } from '../lib/db';
import { formatDate, todayISO, formatMoney } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader } from '../components/ui';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const TYPE_LABELS: Record<string, string> = {
  contract: 'Vertrag', avv: 'AVV', offer: 'Angebot', invoice: 'Rechnung', other: 'Sonstiges',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf', sent: 'Versendet', signed: 'Unterzeichnet', archived: 'Archiviert', cancelled: 'Storniert',
};

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral', sent: 'info', signed: 'success', archived: 'warning', cancelled: 'danger',
};

const STATUS_ORDER: string[] = ['draft', 'sent', 'signed', 'archived', 'cancelled'];

const PDF_COLORS = {
  petrol: [31, 62, 68] as [number, number, number],
  gold: [180, 132, 105] as [number, number, number],
  bordeaux: [115, 56, 67] as [number, number, number],
  ink: [40, 40, 40] as [number, number, number],
  muted: [120, 120, 120] as [number, number, number],
  paleGold: [247, 243, 240] as [number, number, number],
};

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

function getFileIcon(mime: string | null | undefined, isInvoice?: boolean) {
  if (isInvoice) return <Wallet size={16} className="text-success-600" />;
  if (isImage(mime)) return <Image size={16} className="text-accent-600" />;
  if (mime?.includes('pdf')) return <FileText size={16} className="text-danger-500" />;
  return <FileText size={16} className="text-ink-500" />;
}

// Sicheres Dekodieren von Base64-Daten für die Textvorschau
function decodeFileData(doc: any): string {
  try {
    const data = doc.file_data || doc.file_path;
    if (!data) return '';
    return atob(data);
  } catch (err) {
    return doc.file_data || doc.file_path || '';
  }
}

function downloadDocument(doc: Document) {
  const base64Data = (doc as any).file_data || doc.file_path;
  if (!base64Data) return;
  
  const link = document.createElement('a');
  link.href = `data:${(doc as any).file_mime || 'application/octet-stream'};base64,${base64Data}`;
  link.download = doc.file_name || doc.title;
  link.click();
}

export function DocumentsView() {
  const [list, setList] = useState<any[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<'all' | string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');
  const [entityFilter, setEntityFilter] = useState<'all' | 'client' | 'project' | 'general'>('all');
  
  const [previewDoc, setPreviewDoc] = useState<any>(null);

  const load = useCallback(async () => {
    const docList = await documents.list();
    const invList = await invoices.list();
    const clientsData = await clients.list();
    const projectsData = await projects.list();

    setClientList(clientsData);
    setProjectList(projectsData);

    // Rechnungen in das Dokumentenarchiv-Format transformieren
    const mappedInvoices = invList.map(i => {
      const proj = projectsData.find(p => p.id === i.project_id);
      const clientName = i.client_name || (proj?.client_name) || 'Allgemein';
      const entityName = proj ? `${clientName} · ${proj.name}` : clientName;

      return {
        id: i.id,
        entity_type: i.project_id ? 'project' : 'client',
        entity_id: i.project_id || i.client_id || null,
        entity_name: entityName,
        document_type: 'invoice',
        title: `Rechnung ${i.invoice_number || 'Entwurf'}`,
        version: null,
        status: i.status === 'paid' ? 'signed' : i.status === 'cancelled' ? 'cancelled' : i.status === 'overdue' ? 'sent' : 'draft',
        file_name: `Rechnung-${i.invoice_number || 'Draft'}.pdf`,
        file_path: null,
        file_data: null, 
        file_mime: 'application/pdf',
        file_size: null,
        notes: i.notes,
        created_at: i.created_at,
        updated_at: i.updated_at,
        isInvoice: true,
        originalInvoice: i
      };
    });

    setList([...docList, ...mappedInvoices]);
  }, []);

  useEffect(() => { load(); }, [load]);

  let filtered = list;
  if (filter !== 'all') filtered = filtered.filter(d => d.status === filter);
  if (typeFilter !== 'all') filtered = filtered.filter(d => d.document_type === typeFilter);
  if (entityFilter !== 'all') {
    if (entityFilter === 'general') {
      filtered = filtered.filter(d => d.entity_type === 'general' || !d.entity_id);
    } else if (entityFilter === 'client') {
      // FIX: Zeige sowohl direkte Kundendokumente als auch die Projekt-Zugehörigen an!
      filtered = filtered.filter(d => d.entity_type === 'client' || d.entity_type === 'project');
    } else {
      filtered = filtered.filter(d => d.entity_type === entityFilter);
    }
  }

  const byStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = list.filter(d => d.status === s);
    return acc;
  }, {} as Record<string, any[]>);

  async function updateStatus(doc: any, status: DocumentStatus) {
    if (doc.isInvoice) {
      const invStatus = status === 'signed' ? 'paid' : status === 'cancelled' ? 'cancelled' : 'open';
      await invoices.update(doc.id, { status: invStatus as any });
    } else {
      await documents.update(doc.id, { status } as Partial<Document>);
    }
    load();
  }

  async function remove(doc: any) {
    if (confirm('Dokument wirklich löschen?')) {
      if (doc.isInvoice) {
        await invoices.remove(doc.id);
      } else {
        await documents.remove(doc.id);
      }
      load();
    }
  }

  async function handlePreview(doc: any) {
    if (doc.isInvoice) {
      const pdf = await generateInvoicePdfHelper(doc.originalInvoice);
      const base64 = pdf.output('datauristring').split('base64,')[1];
      setPreviewDoc({
        ...doc,
        file_data: base64
      });
    } else {
      setPreviewDoc(doc);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Dokumentenarchiv</h1>
          <p className="text-sm text-ink-500 mt-0.5">Rechtlich relevante Dokumente und Rechnungen verwalten</p>
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
            <p className="text-lg font-semibold text-ink-900">{byStatus[s]?.length || 0}</p>
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
          {(['all', 'contract', 'avv', 'offer', 'invoice', 'other'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`chip transition-colors ${typeFilter === t ? 'bg-accent-600 text-white' : 'bg-surfaceMuted text-ink-700 hover:bg-line'}`}
            >
              {TYPE_LABELS[t]}
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
                onStatusChange={(status) => updateStatus(doc, status)}
                onRemove={() => remove(doc)}
                onEdit={load}
                onPreview={() => handlePreview(doc)}
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
          
          {previewDoc.file_mime && isImage(previewDoc.file_mime) ? (
            <img
              src={`data:${previewDoc.file_mime};base64,${previewDoc.file_data || previewDoc.file_path}`}
              alt={previewDoc.title}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : previewDoc.file_mime === 'application/pdf' ? (
            <iframe
              src={`data:${previewDoc.file_mime};base64,${previewDoc.file_data || previewDoc.file_path}`}
              className="w-full h-full max-w-4xl max-h-[80vh] rounded-lg bg-white"
              onClick={(e) => e.stopPropagation()}
              title={previewDoc.title}
            />
          ) : (
            // FIX: Vorschau-Struktur auf ein schickes, hoch-lesbares Dunkelgrau/Code-Design geändert
            <pre
              className="max-w-full max-h-full p-6 rounded-lg bg-slate-950 text-slate-100 border border-slate-800 overflow-auto text-sm font-mono whitespace-pre-wrap"
              onClick={(e) => e.stopPropagation()}
            >
              {decodeFileData(previewDoc)}
            </pre>
          )}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-white/10 text-white text-sm flex items-center gap-4">
            <span>{previewDoc.title}</span>
            <button
              onClick={async (e) => { 
                e.stopPropagation(); 
                if (previewDoc.isInvoice) {
                  const pdf = await generateInvoicePdfHelper(previewDoc.originalInvoice);
                  pdf.save(`Rechnung-${previewDoc.originalInvoice.invoice_number}.pdf`);
                } else {
                  downloadDocument(previewDoc); 
                }
              }}
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
  document: any;
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

  const hasFile = !!(document.file_data || document.file_path || document.isInvoice);
  const mime = document.file_mime;

  return (
    <>
      <div className="flex items-center gap-3 py-3 group">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-surfaceMuted text-ink-500">
          {getFileIcon(mime, document.isInvoice)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{document.title}</p>
          <p className="text-2xs text-ink-500 truncate mt-1">
            <span className="inline-block px-1.5 py-0.5 rounded bg-surfaceAlt text-ink-600 mr-1.5 font-bold uppercase tracking-wider text-[9px]">{TYPE_LABELS[document.document_type]}</span>
            {document.entity_name}
            {document.version && ` · v${document.version}`}
            {document.file_size && ` · ${document.file_name} ${formatSize(document.file_size)}`}
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

          {hasFile && (
            <button onClick={onPreview} className="p-1 text-accent-600 hover:text-accent-700 opacity-0 group-hover:opacity-100" title="Vorschau">
              <Eye size={14} />
            </button>
          )}
          {hasFile && !document.isInvoice && (
            <button onClick={() => downloadDocument(document)} className="p-1 text-ink-400 hover:text-ink-600 opacity-0 group-hover:opacity-100" title="Download">
              <Download size={14} />
            </button>
          )}
          {hasFile && document.isInvoice && (
            <button 
              onClick={async () => {
                const pdf = await generateInvoicePdfHelper(document.originalInvoice);
                pdf.save(`Rechnung-${document.originalInvoice.invoice_number}.pdf`);
              }} 
              className="p-1 text-ink-400 hover:text-ink-600 opacity-0 group-hover:opacity-100" 
              title="Download"
            >
              <Download size={14} />
            </button>
          )}

          {!document.isInvoice && (
            <button onClick={() => setEditing(true)} className="p-1 text-ink-400 hover:text-accent-600 opacity-0 group-hover:opacity-100">
              <Pencil size={14} />
            </button>
          )}
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
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('contract');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<DocumentStatus>('draft');
  const [notes, setNotes] = useState('');

  // Datei-Upload
  const [uploading, setUploading] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ name: string; mime: string; size: number; data: string } | null>(null);

  // Gefilterte Projekte für den ausgewählten Kunden
  const availableProjects = selectedClientId 
    ? projects.filter(p => p.client_id === selectedClientId)
    : projects;

  // Wenn ein Projekt gewählt wird, den dazugehörigen Kunden automatisch setzen
  function handleProjectChange(pid: string) {
    setSelectedProjectId(pid);
    if (pid) {
      const proj = projects.find(p => p.id === pid);
      if (proj && proj.client_id) {
        setSelectedClientId(proj.client_id);
      }
    }
  }

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
      if (!title) {
        setTitle(res.name?.split('.')[0] || 'Neues Dokument');
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!title.trim()) return;

    // Entity Zuordnungen auflösen
    const finalEntityType = selectedProjectId ? 'project' : (selectedClientId ? 'client' : 'general');
    const finalEntityId = selectedProjectId || selectedClientId || null;
    
    const clientName = clients.find(c => c.id === selectedClientId)?.name || 'Allgemein';
    const finalEntityName = selectedProjectId 
      ? `${clientName} · ${projects.find(p => p.id === selectedProjectId)?.name}`
      : (selectedClientId ? clientName : 'Allgemein');

    const id = await uuid();
    await documents.insert({
      id,
      entity_type: finalEntityType,
      entity_id: finalEntityId,
      entity_name: finalEntityName,
      document_type: documentType,
      title: title.trim(),
      version: version.trim() || null,
      status,
      file_name: fileMeta?.name || null,
      file_path: null,
      file_data: fileMeta?.data || null,
      file_mime: fileMeta?.mime || null,
      file_size: fileMeta?.size || null,
      notes: notes.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    setSelectedClientId(''); setSelectedProjectId(''); setTitle(''); setVersion(''); setNotes(''); setFileMeta(null);
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

        {/* Parallele Verknüpfung: Kunde + Projekt */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kunde (Optional)">
            <select 
              className="input" 
              value={selectedClientId} 
              onChange={(e) => {
                setSelectedClientId(e.target.value);
                setSelectedProjectId(''); // Reset Projekt bei Kundenwechsel
              }}
            >
              <option value="">— Kein Kunde —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          
          <Field label="Projekt (Optional)">
            <select 
              className="input" 
              value={selectedProjectId} 
              onChange={(e) => handleProjectChange(e.target.value)}
            >
              <option value="">— Kein Projekt —</option>
              {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Typ">
            <select className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
              <option value="contract">Vertrag</option>
              <option value="avv">AVV</option>
              <option value="offer">Angebot</option>
              <option value="invoice">Rechnung</option> {/* FIX: Option hinzugefügt */}
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
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Rahmenvertrag 2026" />
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
              <option value="invoice">Rechnung</option> {/* FIX: Option hinzugefügt */}
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

// ---------------------------------------------------------------------------
// Rechnungs-PDF Generator Hilfsfunktion (exakt synchron zur InvoicesView)
// ---------------------------------------------------------------------------

async function generateInvoicePdfHelper(inv: Invoice): Promise<jsPDF> {
  const ownerRow = await settings.get('owner_data');
  let owner = { name: 'Dein Name', company: '', address: 'Deine Adresse', email: '', iban: '', bankName: '' };
  if (ownerRow) {
    try {
      const data = JSON.parse(ownerRow.value);
      owner = { ...owner, ...data };
    } catch (err) { /* ignore */ }
  }

  const { petrol, gold, bordeaux, ink, muted, paleGold } = PDF_COLORS;
  const doc = new jsPDF() as jsPDF & { lastAutoTable: { finalY: number } };
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;

  // Header band
  doc.setFillColor(...petrol);
  doc.rect(0, 0, pageWidth, 38, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 38, pageWidth, 1.2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('RECHNUNG', margin, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(225, 216, 208);
  doc.text(`Nr. ${inv.invoice_number}`, margin, 30);

  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text(owner.company || owner.name || '', pageWidth - margin, 22, { align: 'right' });

  doc.setTextColor(...ink);

  // Storniert Wasserzeichen
  if (inv.status === 'cancelled') {
    doc.setTextColor(220, 90, 90);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(70);
    const GState = (doc as any).GState;
    if (GState) { (doc as any).setGState(new GState({ opacity: 0.13 })); }
    doc.text('STORNIERT', pageWidth / 2, pageHeight / 2, { align: 'center', angle: 35 });
    if (GState) { (doc as any).setGState(new GState({ opacity: 1 })); }
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
  }

  let y = 52;
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text('VON', margin, y);
  doc.text('AN', pageWidth / 2 + 6, y);
  y += 5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text(owner.name || 'Dein Name', margin, y);
  doc.text(inv.client_name, pageWidth / 2 + 6, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);

  let leftY = y + 5;
  let rightY = y + 5;
  if (owner.company) { doc.text(owner.company, margin, leftY); leftY += 4.6; }
  owner.address?.split('\n').forEach((line: string) => { doc.text(line, margin, leftY); leftY += 4.6; });
  if (owner.email) { doc.text(owner.email, margin, leftY); leftY += 4.6; }

  if (inv.client_company) { doc.text(inv.client_company, pageWidth / 2 + 6, rightY); rightY += 4.6; }
  if (inv.client_address) {
    inv.client_address.split('\n').forEach(line => { doc.text(line, pageWidth / 2 + 6, rightY); rightY += 4.6; });
  }
  if (inv.client_email) { doc.text(inv.client_email, pageWidth / 2 + 6, rightY); rightY += 4.6; }

  doc.setTextColor(...ink);
  y = Math.max(leftY, rightY) + 6;

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text('RECHNUNGSDATUM', margin, y);
  doc.text('FÄLLIG BIS', margin + 55, y);
  if (inv.avv_accepted) doc.text('AVV', margin + 110, y);
  y += 5;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ink);
  doc.text(formatDate(inv.issued_date), margin, y);
  doc.text(inv.due_date ? formatDate(inv.due_date) : '—', margin + 55, y);
  if (inv.avv_accepted) {
    doc.setTextColor(...bordeaux);
    doc.text('Akzeptiert' + (inv.avv_accepted_at ? ` (${formatDate(inv.avv_accepted_at)})` : ''), margin + 110, y);
    doc.setTextColor(...ink);
  }
  y += 11;

  if (inv.status === 'cancelled') {
    doc.setFillColor(252, 235, 235);
    doc.roundedRect(margin, y - 5, pageWidth - margin * 2, inv.cancel_reason ? 14 : 9, 1.5, 1.5, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(190, 60, 60);
    doc.text(`Storniert${inv.cancelled_at ? ` am ${formatDate(inv.cancelled_at)}` : ''}`, margin + 3, y);
    doc.setFont('helvetica', 'normal');
    if (inv.cancel_reason) {
      doc.setFontSize(8);
      doc.setTextColor(150, 70, 70);
      doc.text(`Grund: ${inv.cancel_reason}`, margin + 3, y + 5.5);
    }
    doc.setTextColor(...ink);
    y += inv.cancel_reason ? 16 : 11;
  }

  const positions: InvoicePosition[] = JSON.parse(inv.positions_json || '[]');

  if (positions.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Beschreibung', 'Menge', 'Einheit', 'Einzelpreis', 'Gesamt']],
      body: positions.map(p => [
        p.description,
        String(p.quantity),
        p.unit,
        formatMoney(p.unit_price_cents),
        formatMoney(p.total_cents),
      ]),
      theme: 'plain',
      margin: { left: margin, right: margin },
      headStyles: {
        fillColor: petrol,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
      },
      bodyStyles: {
        fontSize: 9,
        textColor: ink,
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        lineColor: [230, 226, 222],
        lineWidth: 0.1,
      },
      alternateRowStyles: { fillColor: paleGold },
      columnStyles: {
        0: { cellWidth: 78 },
        1: { cellWidth: 20, halign: 'right' },
        2: { cellWidth: 22, halign: 'center' },
        3: { cellWidth: 30, halign: 'right' },
        4: { cellWidth: 30, halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + 10;
  } else {
    y += 5;
  }

  const totalsX = pageWidth - margin - 70;
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  doc.text('Zwischensumme', totalsX, y);
  doc.setTextColor(...ink);
  doc.text(formatMoney(inv.subtotal_cents), pageWidth - margin, y, { align: 'right' });
  y += 6;
  doc.setTextColor(...muted);
  doc.text(`USt. (${inv.tax_rate_pct}%)`, totalsX, y);
  doc.setTextColor(...ink);
  doc.text(formatMoney(inv.tax_amount_cents), pageWidth - margin, y, { align: 'right' });
  y += 4;

  doc.setDrawColor(...gold);
  doc.setLineWidth(0.3);
  doc.line(totalsX, y, pageWidth - margin, y);
  y += 8;

  doc.setFillColor(...petrol);
  doc.roundedRect(totalsX - 4, y - 6.5, (pageWidth - margin) - (totalsX - 4), 11, 1.5, 1.5, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Gesamtbetrag', totalsX, y + 1);
  doc.text(formatMoney(inv.total_cents), pageWidth - margin, y + 1, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);

  y += 22;
  if (y > pageHeight - 45) { doc.addPage(); y = 25; }

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...bordeaux);
  doc.text('ZAHLUNGSINFORMATIONEN', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);
  y += 6;
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text('Bitte überweise den Betrag innerhalb des Zahlungsziels auf folgendes Konto:', margin, y);
  y += 5;
  if (owner.iban) {
    doc.text(`IBAN: ${owner.iban}`, margin, y);
    if (owner.bankName) { y += 4.8; doc.text(`Bank: ${owner.bankName}`, margin, y); }
  } else {
    doc.text('IBAN: —', margin, y);
  }
  y += 4.8;
  doc.text(`Verwendungszweck: ${inv.invoice_number}`, margin, y);

  // Footer
  doc.setDrawColor(...gold);
  doc.setLineWidth(0.3);
  doc.line(margin, pageHeight - 22, pageWidth - margin, pageHeight - 22);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...muted);
  doc.text('Vielen Dank für deinen Auftrag!', pageWidth / 2, pageHeight - 15, { align: 'center' });

  return doc;
}