

import { useEffect, useState } from 'react';
import {
  Database, Download, Info, Save, HardDrive, Plus, X,
  FileJson, FileSpreadsheet, RotateCcw, Trash2, User, Clock,
} from 'lucide-react';

import {
  settings, backup, restore, isElectron,
  getPlatforms, setPlatforms, getFormats, setFormats,
  exportCsv, exportJson,
  resetDatabase,
} from '../lib/db';

import { Badge, Field, SectionHeader } from '../components/ui';

export function SettingsView() {
  const [currency, setCurrency] = useState('EUR');
  const [fiscalStart, setFiscalStart] = useState('1');
  const [weeklyCapacity, setWeeklyCapacity] = useState('40');
  const [backupState, setBackupState] = useState<{ status: 'idle' | 'ok' | 'error'; msg?: string }>({ status: 'idle' });
  const [restoreState, setRestoreState] = useState<{ status: 'idle' | 'ok' | 'error'; msg?: string }>({ status: 'idle' });

  const [platforms, setPlatformList] = useState<string[]>([]);
  const [formats, setFormatList] = useState<string[]>([]);
  const [newPlatform, setNewPlatform] = useState('');
  const [newFormat, setNewFormat] = useState('');

  // Inhaber-Daten
  const [ownerName, setOwnerName] = useState('');
  const [ownerCompany, setOwnerCompany] = useState('');
  const [ownerAddress, setOwnerAddress] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerIban, setOwnerIban] = useState('');
  const [ownerBankName, setOwnerBankName] = useState('');
  const [ownerTaxId, setOwnerTaxId] = useState('');
  const [ownerSaved, setOwnerSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await settings.get('currency_default');
      if (c) setCurrency(c.value);

      const f = await settings.get('fiscal_year_start_month');
      if (f) setFiscalStart(f.value);

      const wc = await settings.get('weekly_capacity_hours');
      if (wc) setWeeklyCapacity(wc.value);

      const ownerRow = await settings.get('owner_data');
      if (ownerRow) {
        try {
          const d = JSON.parse(ownerRow.value);
          setOwnerName(d.name || '');
          setOwnerCompany(d.company || '');
          setOwnerAddress(d.address || '');
          setOwnerEmail(d.email || '');
          setOwnerPhone(d.phone || '');
          setOwnerIban(d.iban || '');
          setOwnerBankName(d.bankName || '');
          setOwnerTaxId(d.taxId || '');
        } catch { /* ignore */ }
      }

      setPlatformList(await getPlatforms());
      setFormatList(await getFormats());
    })();
  }, []);

  async function savePrefs() {
    await settings.set('currency_default', currency);
    await settings.set('fiscal_year_start_month', fiscalStart);
    await settings.set('weekly_capacity_hours', weeklyCapacity);
  }

  async function saveOwnerData() {
    await settings.set('owner_data', JSON.stringify({
      name: ownerName.trim(),
      company: ownerCompany.trim(),
      address: ownerAddress.trim(),
      email: ownerEmail.trim(),
      phone: ownerPhone.trim(),
      iban: ownerIban.trim(),
      bankName: ownerBankName.trim(),
      taxId: ownerTaxId.trim(),
    }));
    setOwnerSaved(true);
    setTimeout(() => setOwnerSaved(false), 2000);
  }

  async function doBackup() {
    setBackupState({ status: 'idle' });
    const res = await backup();
    if (res.ok) setBackupState({ status: 'ok', msg: res.path });
    else setBackupState({ status: 'error', msg: res.reason });
  }

  async function doRestore() {
    if (!confirm('Wiederherstellung überschreibt die aktuelle Datenbank. App startet danach neu. Fortfahren?')) return;
    setRestoreState({ status: 'idle' });
    const res = await restore();
    if (res.ok) {
      setRestoreState({ status: 'ok', msg: 'Wiederhergestellt. App wird neu geladen…' });
      setTimeout(() => location.reload(), 1200);
    } else {
      setRestoreState({ status: 'error', msg: res.reason });
    }
  }

  async function doResetDatabase() {
    if (!confirm('ALLES wird gelöscht. Wirklich komplette Datenbank zurücksetzen?')) return;
    const res = await resetDatabase();
    if (res.ok) {
      alert('Datenbank geleert.');
      location.reload();
    } else {
      alert('Reset fehlgeschlagen: ' + res.reason);
    }
  }

  async function addPlatform() {
    const v = newPlatform.trim().toLowerCase().replace(/\s+/g, '_');
    if (!v || platforms.includes(v)) return;
    const next = [...platforms, v];
    setPlatformList(next);
    await setPlatforms(next);
    setNewPlatform('');
  }

  async function removePlatform(p: string) {
    const next = platforms.filter(x => x !== p);
    setPlatformList(next);
    await setPlatforms(next);
  }

  async function addFormat() {
    const v = newFormat.trim().toLowerCase().replace(/\s+/g, '_');
    if (!v || formats.includes(v)) return;
    const next = [...formats, v];
    setFormatList(next);
    await setFormats(next);
    setNewFormat('');
  }

  async function removeFormat(f: string) {
    const next = formats.filter(x => x !== f);
    setFormatList(next);
    await setFormats(next);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink-900">Einstellungen</h1>
        <p className="text-sm text-ink-500 mt-0.5">App-weite Konfiguration</p>
      </div>

      {/* Laufzeit */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={18} className="text-accent-600" />
          <h2 className="section-title">Laufzeit</h2>
        </div>
        <Badge tone={isElectron() ? 'success' : 'warning'}>
          {isElectron() ? 'Electron · lokale SQLite-Datenbank aktiv' : 'Browser · Mock-Modus'}
        </Badge>
      </div>

      {/* Inhaber-Daten — wird für Rechnungs- und AVV-PDFs verwendet */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <User size={18} className="text-accent-600" />
          <h2 className="section-title">Meine Daten</h2>
        </div>
        <p className="text-sm text-ink-500 mb-4">
          Diese Daten erscheinen auf deinen Rechnungs- und AVV-PDFs als Absenderin.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Sophie Ischenko" />
            </Field>
            <Field label="Firma (optional)">
              <input className="input" value={ownerCompany} onChange={(e) => setOwnerCompany(e.target.value)} placeholder="Fundament Studio" />
            </Field>
          </div>
          <Field label="Adresse">
            <textarea
              className="input min-h-[70px] resize-y"
              value={ownerAddress}
              onChange={(e) => setOwnerAddress(e.target.value)}
              placeholder={`Musterstraße 1\n32657 Lemgo`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="E-Mail">
              <input type="email" className="input" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="hallo@fundament-studio.de" />
            </Field>
            <Field label="Telefon (optional)">
              <input className="input" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+49 …" />
            </Field>
          </div>
          <div className="border-t border-line pt-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400 mb-2">Bankverbindung (für Rechnungen)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IBAN">
                <input className="input font-mono" value={ownerIban} onChange={(e) => setOwnerIban(e.target.value)} placeholder="DE89 …" />
              </Field>
              <Field label="Bank">
                <input className="input" value={ownerBankName} onChange={(e) => setOwnerBankName(e.target.value)} placeholder="Sparkasse …" />
              </Field>
            </div>
          </div>
          <Field label="Steuernummer / USt-IdNr. (optional)">
            <input className="input" value={ownerTaxId} onChange={(e) => setOwnerTaxId(e.target.value)} placeholder="DE…" />
          </Field>
          <button onClick={saveOwnerData} className="btn-primary">
            <Save size={14} /> {ownerSaved ? 'Gespeichert ✓' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Präferenzen */}
      <div className="card p-5">
        <SectionHeader title="Präferenzen" />
        <div className="space-y-3">
          <Field label="Standardwährung">
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="CHF">CHF</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
          <Field label="Geschäftsjahr Start">
            <select className="input" value={fiscalStart} onChange={(e) => setFiscalStart(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>
                  {new Date(2000, m - 1, 1).toLocaleDateString('de-DE', { month: 'long' })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Wochenkapazität (Stunden)" hint="Wird in der Kapazitätsplanung als Limit verwendet">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="80"
                step="0.5"
                className="input w-24"
                value={weeklyCapacity}
                onChange={(e) => setWeeklyCapacity(e.target.value)}
              />
              <span className="text-sm text-ink-500">Stunden/Woche</span>
            </div>
          </Field>
          <button onClick={savePrefs} className="btn-primary">
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>

      {/* Social-Media-Plattformen */}
      <div className="card p-5">
        <SectionHeader title="Social-Media-Plattformen" />
        <p className="text-sm text-ink-500 mb-3">Diese Plattformen stehen im Social Planer zur Auswahl.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {platforms.map(p => (
            <span key={p} className="chip bg-accent-50 text-accent-700">
              {p}
              <button onClick={() => removePlatform(p)} className="ml-1 hover:text-danger-600"><X size={12} /></button>
            </span>
          ))}
          {platforms.length === 0 && <p className="text-sm text-ink-400">Keine Plattformen</p>}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="z.B. threads"
            value={newPlatform}
            onChange={(e) => setNewPlatform(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addPlatform(); }}
          />
          <button onClick={addPlatform} className="btn-outline"><Plus size={14} /> Hinzufügen</button>
        </div>
      </div>

      {/* Post-Formate */}
      <div className="card p-5">
        <SectionHeader title="Post-Formate" />
        <p className="text-sm text-ink-500 mb-3">Diese Formate stehen im Social Planer zur Auswahl.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {formats.map(f => (
            <span key={f} className="chip bg-accent-50 text-accent-700">
              {f}
              <button onClick={() => removeFormat(f)} className="ml-1 hover:text-danger-600"><X size={12} /></button>
            </span>
          ))}
          {formats.length === 0 && <p className="text-sm text-ink-400">Keine Formate</p>}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="z.B. live_stream"
            value={newFormat}
            onChange={(e) => setNewFormat(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFormat(); }}
          />
          <button onClick={addFormat} className="btn-outline"><Plus size={14} /> Hinzufügen</button>
        </div>
      </div>

      {/* Export */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Download size={18} className="text-accent-600" />
          <h2 className="section-title">Daten exportieren</h2>
        </div>
        <p className="text-sm text-ink-500 mb-4">
          Exportiere deine Daten als CSV (einzelne Tabellen) oder als komplettes JSON-Backup aller Tabellen.
        </p>
        <div className="space-y-3">
          <div>
            <p className="label">CSV-Export (einzelne Tabelle)</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => exportCsv('projects')} className="btn-outline text-sm"><FileSpreadsheet size={14} /> Projekte</button>
              <button onClick={() => exportCsv('transactions')} className="btn-outline text-sm"><FileSpreadsheet size={14} /> Buchungen</button>
              <button onClick={() => exportCsv('invoices')} className="btn-outline text-sm"><FileSpreadsheet size={14} /> Rechnungen</button>
              <button onClick={() => exportCsv('time_entries')} className="btn-outline text-sm"><FileSpreadsheet size={14} /> Zeiterfassung</button>
              <button onClick={() => exportCsv('social_posts')} className="btn-outline text-sm"><FileSpreadsheet size={14} /> Social Posts</button>
            </div>
          </div>
          <div className="h-px bg-line" />
          <div>
            <p className="label">Komplett-Export</p>
            <button onClick={() => exportJson()} className="btn-primary"><FileJson size={15} /> Alle Daten als JSON</button>
          </div>
        </div>
      </div>

      {/* Backup */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Database size={18} className="text-accent-600" />
          <h2 className="section-title">Datenbank-Backup</h2>
        </div>
        <p className="text-sm text-ink-500 mb-4">
          Erstelle eine Kopie deiner lokalen SQLite-Datenbankdatei. Nur in der Electron-App verfügbar.
        </p>
        <div className="flex gap-2">
          <button onClick={doBackup} disabled={!isElectron()} className="btn-outline">
            <Download size={15} /> Backup erstellen
          </button>
          <button onClick={doRestore} disabled={!isElectron()} className="btn-outline">
            <RotateCcw size={15} /> Restore
          </button>
        </div>
        {backupState.status === 'ok' && <p className="text-sm text-success-700 mt-3">Backup gespeichert: {backupState.msg}</p>}
        {backupState.status === 'error' && <p className="text-sm text-danger-600 mt-3">Backup fehlgeschlagen: {backupState.msg}</p>}
        {restoreState.status === 'ok' && <p className="text-sm text-success-700 mt-3">{restoreState.msg}</p>}
        {restoreState.status === 'error' && <p className="text-sm text-danger-600 mt-3">Restore fehlgeschlagen: {restoreState.msg}</p>}
      </div>

      {/* Gefahrenzone */}
      <div className="card p-5 border border-danger-200">
        <div className="flex items-center gap-2 mb-2">
          <Trash2 size={16} className="text-danger-600" />
          <h2 className="section-title text-danger-600">Gefahrenzone</h2>
        </div>
        <p className="text-sm text-ink-500 mb-3">Löscht ALLE Daten in der SQLite-Datenbank.</p>
        <button onClick={doResetDatabase} className="btn-outline text-danger-600 border-danger-300 hover:bg-danger-50">
          Datenbank komplett leeren
        </button>
      </div>

      {/* About */}
      <div className="card p-5 bg-surfaceAlt/30">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-ink-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-ink-900">Studio OS · v2.0.0</p>
            <p className="text-sm text-ink-500 mt-1">
              Lokaler Arbeitsraum für Webdesignerinnen. Single-User, keine Cloud, kein Sync.
              Daten liegen in einer SQLite-Datei im Benutzerordner.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}