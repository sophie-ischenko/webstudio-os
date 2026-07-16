import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Users, Mail, Phone, MapPin, FileText,
  CheckCircle2, Circle, ChevronRight, FolderKanban, Wallet,
} from 'lucide-react';
import { clients, onboarding, projects, invoices, contracts, uuid } from '../lib/db';
import type {
  Client,
  ClientOnboardingItem,
  Project,
  Invoice,
  Contract,
  ClientOnboardingStatus,
} from '../types';
import { formatMoney, formatDate } from '../lib/format';
import { Badge, EmptyState, Field, Modal, SectionHeader, ConfirmInline } from '../components/ui';

const STATUS_LABELS: Record<ClientOnboardingStatus, string> = {
  new: 'Neu',
  active: 'Aktiv',
  inactive: 'Inaktiv',
};
const STATUS_TONE: Record<ClientOnboardingStatus, 'neutral' | 'success' | 'warning'> = {
  new: 'warning',
  active: 'success',
  inactive: 'neutral',
};

const DEFAULT_ONBOARDING = [
  'Vertrag unterzeichnet',
  'AVV (Auftragsverarbeitungsvertrag) erstellt',
  'Zugangsdaten übergeben',
  'Rechnungsdaten erfasst',
  'Kickoff-Termin vereinbart',
];

export function ClientsView() {
  const [list, setList] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setList(await clients.list());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink-900">Kunden</h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {list.length} Kunden · {list.filter(c => c.onboarding_status === 'active').length} aktiv
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} /> Neuer Kunde
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            icon={<Users size={24} />}
            title="Keine Kunden"
            hint="Erfasse deine Kunden mit Kontaktdaten und Onboarding-Checkliste."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="card p-4 text-left hover:shadow-soft transition-shadow group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p>
                  {c.company && <p className="text-2xs text-ink-500 truncate">{c.company}</p>}
                </div>
                <Badge tone={STATUS_TONE[c.onboarding_status]}>{STATUS_LABELS[c.onboarding_status]}</Badge>
              </div>

              <div className="space-y-1 text-2xs text-ink-500">
                {c.email && (
                  <p className="flex items-center gap-1.5 truncate">
                    <Mail size={11} /> {c.email}
                  </p>
                )}

                {c.phone && <p className="flex items-center gap-1.5"><Phone size={11} /> {c.phone}</p>}
              </div>

              <div className="flex items-center gap-1 mt-3 text-2xs text-accent-600 group-hover:text-accent-700">
                Details <ChevronRight size={12} />
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ClientDetailModal
          client={selected}
          onClose={() => setSelected(null)}
          onUpdated={load}
        />
      )}

      {showAdd && (
        <AddClientModal
          onAdded={load}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function ClientDetailModal({
  client,
  onClose,
  onUpdated,
}: {
  client: Client;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [invoiceList, setInvoiceList] = useState<Invoice[]>([]);
  const [contractList, setContractList] = useState<Contract[]>([]);
  const [onboardingList, setOnboardingList] = useState<ClientOnboardingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState(client.name);
  const [editCompany, setEditCompany] = useState(client.company || '');
  const [editEmail, setEditEmail] = useState(client.email || '');
  const [editPhone, setEditPhone] = useState(client.phone || '');
  const [editAddress, setEditAddress] = useState(client.address || '');
  const [editTaxId, setEditTaxId] = useState(client.tax_id || '');

  const load = useCallback(async () => {
    const [projs, invs, conts, onb] = await Promise.all([
      projects.all(),
      invoices.all(),
      contracts.list(),
      onboarding.listByClient(client.id),
    ]);

    setProjectList(projs.filter(p =>
      (p.client_id && p.client_id === client.id) ||
      (!p.client_id && p.client_name === client.name)
    ));

    setInvoiceList(invs.filter(i =>
      (i.client_id && i.client_id === client.id) ||
      (!i.client_id && i.client_name === client.name)
    ));

    setContractList(conts.filter(c => c.client_id === client.id));
    setOnboardingList(onb);
  }, [client.id, client.name]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setEditName(client.name);
    setEditCompany(client.company || '');
    setEditEmail(client.email || '');
    setEditPhone(client.phone || '');
    setEditAddress(client.address || '');
    setEditTaxId(client.tax_id || '');
  }, [client]);

  async function toggleOnboarding(item: ClientOnboardingItem) {
    await onboarding.toggle(item.id, item.is_checked ? 0 : 1);
    load();
  }

  async function addOnboardingItem() {
    if (!newItem.trim()) return;
    const id = await uuid();
    await onboarding.insert({
      id,
      client_id: client.id,
      label: newItem.trim(),
      is_checked: 0,
      checked_at: null,
      position: onboardingList.length,
      created_at: new Date().toISOString(),
    });
    setNewItem('');
    load();
  }

  async function removeOnboardingItem(id: string) {
    await onboarding.remove(id);
    load();
  }

  async function saveClient(fields: Partial<Client>) {
    await clients.update(client.id, fields);
    onUpdated();
  }

  async function saveEditForm() {
    await clients.update(client.id, {
      name: editName.trim(),
      company: editCompany.trim() || null,
      email: editEmail.trim() || null,
      phone: editPhone.trim() || null,
      address: editAddress.trim() || null,
      tax_id: editTaxId.trim() || null,
    });
    setEditMode(false);
    onUpdated();
  }

  async function deleteClient() {
    await clients.remove(client.id);
    onUpdated();
    onClose();
  }

  const totalRevenue = invoiceList
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + i.amount_cents, 0);

  const openInvoices = invoiceList.filter(i => i.status === 'open' || i.status === 'overdue');

  const onboardingPct = onboardingList.length > 0
    ? Math.round(onboardingList.filter(i => i.is_checked).length / onboardingList.length * 100)
    : 0;

  return (
    <Modal open onClose={onClose} title={client.name} size="xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 text-sm">
            <p className="text-2xs font-semibold uppercase text-ink-400">Kontakt</p>
            {client.company && <p className="text-ink-700">{client.company}</p>}

            {client.email && (
              <p className="flex items-center gap-1.5 text-ink-600">
                <Mail size={13} /> {client.email}
              </p>
            )}

            {client.phone && <p className="flex items-center gap-1.5 text-ink-600"><Phone size={13} /> {client.phone}</p>}
            {client.address && <p className="flex items-center gap-1.5 text-ink-600"><MapPin size={13} /> {client.address}</p>}
            {client.tax_id && <p className="text-2xs text-ink-500">Steuernr.: {client.tax_id}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-2xs font-semibold uppercase text-ink-400">Status</p>
            <select
              className="input text-sm"
              value={client.onboarding_status}
              onChange={(e) => saveClient({ onboarding_status: e.target.value as ClientOnboardingStatus })}
            >
              <option value="new">Neu</option>
              <option value="active">Aktiv</option>
              <option value="inactive">Inaktiv</option>
            </select>

            {editMode ? (
              <div className="space-y-2">
                <Field label="Name">
                  <input
                    className="input text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </Field>

                <Field label="Firma">
                  <input
                    className="input text-sm"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                  />
                </Field>

                <Field label="E-Mail">
                  <input
                    className="input text-sm"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="email@beispiel.de"
                  />
                </Field>

                <Field label="Telefon">
                  <input
                    className="input text-sm"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </Field>

                <Field label="Adresse">
                  <input
                    className="input text-sm"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                  />
                </Field>

                <Field label="Steuernummer">
                  <input
                    className="input text-sm"
                    value={editTaxId}
                    onChange={(e) => setEditTaxId(e.target.value)}
                  />
                </Field>

                <div className="flex gap-2 pt-2">
                  <button onClick={saveEditForm} className="btn-primary text-sm">
                    Speichern
                  </button>
                  <button onClick={() => setEditMode(false)} className="btn-ghost text-sm">
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEditMode(true)} className="btn-ghost text-2xs">
                Bearbeiten
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-surfaceAlt/50 text-center">
            <p className="text-2xs text-ink-500 uppercase">Umsatz gesamt</p>
            <p className="text-sm font-semibold text-ink-900 mt-1 tabular-nums">{formatMoney(totalRevenue)}</p>
          </div>
          <div className="p-3 rounded-lg bg-surfaceAlt/50 text-center">
            <p className="text-2xs text-ink-500 uppercase">Offene Rechnungen</p>
            <p className="text-sm font-semibold text-warning-700 mt-1 tabular-nums">
              {formatMoney(openInvoices.reduce((s, i) => s + i.amount_cents, 0))}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-surfaceAlt/50 text-center">
            <p className="text-2xs text-ink-500 uppercase">Onboarding</p>
            <p className="text-sm font-semibold text-ink-900 mt-1 tabular-nums">{onboardingPct}%</p>
          </div>
        </div>

        <div>
          <SectionHeader title="Onboarding-Checkliste" />
          {onboardingList.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-500">Noch keine Items. Schnellstart mit Standard-Checkliste:</p>
              <button
                onClick={async () => {
                  for (let i = 0; i < DEFAULT_ONBOARDING.length; i++) {
                    const id = await uuid();
                    await onboarding.insert({
                      id,
                      client_id: client.id,
                      label: DEFAULT_ONBOARDING[i],
                      is_checked: 0,
                      checked_at: null,
                      position: i,
                      created_at: new Date().toISOString(),
                    });
                  }
                  load();
                }}
                className="btn-outline text-sm"
              >
                <Plus size={14} /> Standard-Checkliste anlegen
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {onboardingList.map(item => (
                <div key={item.id} className="flex items-center gap-2 py-1.5 group">
                  <button onClick={() => toggleOnboarding(item)} className="text-ink-400 hover:text-accent-600">
                    {item.is_checked ? <CheckCircle2 size={16} className="text-success-600" /> : <Circle size={16} />}
                  </button>
                  <span className={`text-sm flex-1 ${item.is_checked ? 'line-through text-ink-400' : 'text-ink-700'}`}>
                    {item.label}
                  </span>
                  {item.checked_at && <span className="text-2xs text-ink-400">{formatDate(item.checked_at)}</span>}
                  <button
                    onClick={() => removeOnboardingItem(item.id)}
                    className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              <div className="flex gap-2 mt-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder="Weiteres Item…"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addOnboardingItem();
                  }}
                />
                <button onClick={addOnboardingItem} className="btn-ghost text-sm">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {projectList.length > 0 && (
          <div>
            <SectionHeader title="Projekte" />
            <div className="space-y-1.5">
              {projectList.map(p => (
                <div key={p.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surfaceAlt/50">
                  <FolderKanban size={14} className="text-accent-600" />
                  <span className="text-sm text-ink-700 flex-1">{p.name}</span>
                  <Badge tone={p.status === 'done' ? 'success' : p.status === 'active' ? 'accent' : 'neutral'}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {contractList.length > 0 && (
          <div>
            <SectionHeader title="Verträge" />
            <div className="space-y-1.5">
              {contractList.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surfaceAlt/50">
                  <FileText size={14} className="text-info-600" />
                  <span className="text-sm text-ink-700 flex-1">{c.title}</span>
                  <span className="text-2xs text-ink-500">{formatMoney(c.monthly_amount_cents)}/Monat</span>
                  <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {invoiceList.length > 0 && (
          <div>
            <SectionHeader title="Rechnungen" />
            <div className="space-y-1.5">
              {invoiceList.slice(0, 5).map(i => (
                <div key={i.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surfaceAlt/50">
                  <Wallet size={14} className="text-ink-400" />
                  <span className="text-sm text-ink-700 flex-1">{i.invoice_number || 'Rechnung'}</span>
                  <span className="text-sm font-medium tabular-nums">{formatMoney(i.amount_cents)}</span>
                  <Badge tone={i.status === 'paid' ? 'success' : 'warning'}>
                    {i.status === 'paid' ? 'Bezahlt' : 'Offen'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-line">
          {confirmDelete ? (
            <ConfirmInline
              message="Kunde wirklich löschen? Verknüpfte Projekte/Rechnungen bleiben erhalten."
              onConfirm={deleteClient}
              onCancel={() => setConfirmDelete(false)}
            />
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-sm text-danger-600 hover:text-danger-700">
              <Trash2 size={14} /> Kunde löschen
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AddClientModal({
  onAdded,
  onClose,
}: {
  onAdded: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [withDefaultOnboarding, setWithDefaultOnboarding] = useState(true);

  async function submit() {
    if (!name.trim()) return;
    const id = await uuid();

    await clients.insert({
      id,
      name: name.trim(),
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      tax_id: taxId.trim() || null,
      onboarding_status: 'new',
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (withDefaultOnboarding) {
      for (let i = 0; i < DEFAULT_ONBOARDING.length; i++) {
        const itemId = await uuid();
        await onboarding.insert({
          id: itemId,
          client_id: id,
          label: DEFAULT_ONBOARDING[i],
          is_checked: 0,
          checked_at: null,
          position: i,
          created_at: new Date().toISOString(),
        });
      }
    }

    setName('');
    setCompany('');
    setEmail('');
    setPhone('');
    setAddress('');
    setTaxId('');
    onAdded();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Neuer Kunde"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Abbrechen</button>
          <button onClick={submit} className="btn-primary" disabled={!name.trim()}>
            Erstellen
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        <Field label="Firma (optional)">
          <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>

        <Field label="E-Mail">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@beispiel.de"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefon">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Adresse">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>

        <Field label="Steuernummer (optional)">
          <input className="input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={withDefaultOnboarding}
            onChange={(e) => setWithDefaultOnboarding(e.target.checked)}
          />
          Standard-Onboarding-Checkliste anlegen
        </label>
      </div>
    </Modal>
  );
}