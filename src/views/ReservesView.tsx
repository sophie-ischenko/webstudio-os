import { useEffect, useState, useCallback } from 'react';
import { PiggyBank, Percent, Save, Info } from 'lucide-react';
import { settings, transactions } from '../lib/db';
import { formatMoney } from '../lib/format';
import { Field, SectionHeader } from '../components/ui';

export function ReservesView() {
  const [taxMode, setTaxMode] = useState<'kleinunternehmer' | 'ust-pflichtig'>('kleinunternehmer');
  const [estRate, setEstRate] = useState('14');
  const [kvRate, setKvRate] = useState('14.6');
  const [rvRate, setRvRate] = useState('18.6');
  const [businessExpensePct, setBusinessExpensePct] = useState('30');
  const [year, setYear] = useState(new Date().getFullYear());
  const [yearIncome, setYearIncome] = useState(0);
  const [yearExpenses, setYearExpenses] = useState(0);

  const load = useCallback(async () => {
    const mode = await settings.get('tax_mode');
    if (mode) setTaxMode(mode.value as 'kleinunternehmer' | 'ust-pflichtig');
    const est = await settings.get('est_rate');
    if (est) setEstRate(est.value);
    const kv = await settings.get('kv_rate');
    if (kv) setKvRate(kv.value);
    const rv = await settings.get('rv_rate');
    if (rv) setRvRate(rv.value);
    const be = await settings.get('business_expense_pct');
    if (be) setBusinessExpensePct(be.value);

    const txList = await transactions.list();
    const yIncome = txList.filter(t => t.type === 'income' && new Date(t.transaction_date).getFullYear() === year).reduce((s, t) => s + t.amount_cents, 0);
    const yExpenses = txList.filter(t => t.type === 'expense' && new Date(t.transaction_date).getFullYear() === year).reduce((s, t) => s + t.amount_cents, 0);
    setYearIncome(yIncome);
    setYearExpenses(yExpenses);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  async function saveSettings() {
    await settings.set('tax_mode', taxMode);
    await settings.set('est_rate', estRate);
    await settings.set('kv_rate', kvRate);
    await settings.set('rv_rate', rvRate);
    await settings.set('business_expense_pct', businessExpensePct);
  }

  const grossIncome = yearIncome;
  const deductibleExpenses = Math.max(yearExpenses, Math.round(grossIncome * (parseFloat(businessExpensePct) || 0) / 100));
  const profit = Math.max(0, grossIncome - deductibleExpenses);
  const estAmount = Math.round(profit * (parseFloat(estRate) || 0) / 100);
  const kvAmount = Math.round(profit * (parseFloat(kvRate) || 0) / 100);
  const rvBasis = Math.min(profit, 8760000);
  const rvAmount = Math.round(rvBasis * (parseFloat(rvRate) || 0) / 100);
  const totalReserves = estAmount + kvAmount + rvAmount;
  const monthlyReserves = Math.round(totalReserves / 12);
  const reservePct = grossIncome > 0 ? Math.round(totalReserves / grossIncome * 100) : 0;
  const ustAmount = taxMode === 'ust-pflichtig' ? Math.round(grossIncome * 19 / 119) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink-900">Rücklagen-Rechner</h1>
        <p className="text-sm text-ink-500 mt-0.5">Einkommensteuer, Kranken- und Rentenversicherung</p>
      </div>

      <div className="card p-5">
        <SectionHeader title="Steuerliche Einordnung" />
        <div className="space-y-4">
          <Field label="Umsatzsteuer-Modus">
            <div className="flex gap-2">
              <button onClick={() => setTaxMode('kleinunternehmer')} className={`btn flex-1 ${taxMode === 'kleinunternehmer' ? 'bg-accent-50 text-accent-700 border border-accent-500/30' : 'bg-surfaceMuted text-ink-500'}`}>
                Kleinunternehmer (§19 UStG)
              </button>
              <button onClick={() => setTaxMode('ust-pflichtig')} className={`btn flex-1 ${taxMode === 'ust-pflichtig' ? 'bg-accent-50 text-accent-700 border border-accent-500/30' : 'bg-surfaceMuted text-ink-500'}`}>
                USt-pflichtig
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ESt-Satz (%) — pauschal"><input type="number" className="input" value={estRate} onChange={(e) => setEstRate(e.target.value)} /></Field>
            <Field label="Geschäftsausgaben-Pauschale (%)"><input type="number" className="input" value={businessExpensePct} onChange={(e) => setBusinessExpensePct(e.target.value)} /></Field>
            <Field label="Krankenversicherung (%)"><input type="number" className="input" value={kvRate} onChange={(e) => setKvRate(e.target.value)} /></Field>
            <Field label="Rentenversicherung (%)"><input type="number" className="input" value={rvRate} onChange={(e) => setRvRate(e.target.value)} /></Field>
          </div>
          <Field label="Jahr">
            <select className="input" value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <button onClick={saveSettings} className="btn-primary"><Save size={15} /> Einstellungen speichern</button>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <PiggyBank size={18} className="text-accent-600" />
          <h2 className="section-title">Rücklagen für {year}</h2>
        </div>
        <div className="space-y-3 mb-4">
          <ResultRow label="Bruttoeinnahmen" value={grossIncome} />
          <ResultRow label="Abzugsfähige Ausgaben (geschätzt)" value={-deductibleExpenses} tone="danger" />
          <div className="h-px bg-line" />
          <ResultRow label="Gewinn (Grundlage)" value={profit} bold />
        </div>
        <div className="space-y-2.5 p-4 rounded-lg bg-surfaceAlt/50">
          <ResultRow label="Einkommensteuer (pauschal)" value={estAmount} icon={<Percent size={13} />} />
          <ResultRow label="Krankenversicherung" value={kvAmount} icon={<Percent size={13} />} />
          <ResultRow label="Rentenversicherung" value={rvAmount} icon={<Percent size={13} />} />
          {taxMode === 'ust-pflichtig' && (
            <ResultRow label="Umsatzsteuer (19% enthalten)" value={ustAmount} icon={<Percent size={13} />} tone="info" />
          )}
          <div className="h-px bg-line" />
          <ResultRow label="Rücklagen gesamt / Jahr" value={totalReserves} bold tone="accent" />
          <ResultRow label="Rücklagen pro Monat" value={monthlyReserves} bold />
        </div>
        <div className="mt-4 p-3 rounded-lg bg-accent-50 border border-accent-500/20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-accent-700">Empfohlene Rücklage pro Einnahme</span>
            <span className="text-lg font-semibold text-accent-700 tabular-nums">{reservePct}%</span>
          </div>
          <p className="text-2xs text-accent-600 mt-1">
            Lege jeden Monat {formatMoney(monthlyReserves)} zurück, um Steuern und Sozialabgaben decken zu können.
          </p>
        </div>
      </div>

      <div className="card p-4 bg-surfaceAlt/30">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-ink-400 shrink-0 mt-0.5" />
          <p className="text-2xs text-ink-500">
            Vereinfachte Rechnung mit Pauschalsätzen. Die tatsächliche Steuerlast hängt von vielen Faktoren ab
            (Freibeträge, Zusammenveranlagung, Gewinneinkommen vs. Überschuss). Für eine verbindliche Berechnung
            wende dich an deinen Steuerberater.
          </p>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, tone, bold, icon }: { label: string; value: number; tone?: 'danger' | 'accent' | 'info'; bold?: boolean; icon?: React.ReactNode }) {
  const color = tone === 'danger' ? 'text-danger-600' : tone === 'accent' ? 'text-accent-700' : tone === 'info' ? 'text-info-600' : 'text-ink-900';
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm flex items-center gap-1.5 ${bold ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
        {icon}{label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${color}`}>
        {value < 0 ? '−' : ''}{formatMoney(Math.abs(value))}
      </span>
    </div>
  );
}
