import { useEffect, useState, useMemo } from 'react';
import { Calculator, Save, Trash2, TrendingUp, Info } from 'lucide-react';
import { hourly, uuid } from '../lib/db';
import type { HourlyRateCalculation } from '../types';
import { formatMoney, formatDate, parseMoneyToCents } from '../lib/format';
import { Badge, EmptyState, Field, SectionHeader } from '../components/ui';

export function CalculatorView() {
  // Inputs
  const [income, setIncome] = useState('40000');
  const [costs, setCosts] = useState('6000');
  const [hoursWeek, setHoursWeek] = useState('25');
  const [weeksYear, setWeeksYear] = useState('42');
  const [buffer, setBuffer] = useState('15');
  const [label, setLabel] = useState('');

  // History
  const [history, setHistory] = useState<HourlyRateCalculation[]>([]);

  useEffect(() => { (async () => setHistory(await hourly.list()))(); }, []);

  // Live calculation
  const result = useMemo(() => {
    const incomeCents = parseMoneyToCents(income);
    const costsCents = parseMoneyToCents(costs);
    const hWeek = parseFloat(hoursWeek) || 0;
    const wYear = parseFloat(weeksYear) || 0;
    const bufPct = parseFloat(buffer) || 0;

    const totalCosts = incomeCents + costsCents;
    const billableHoursYear = hWeek * wYear;
    if (billableHoursYear <= 0) return { hourly: 0, monthly: 0, billableHoursYear: 0, totalCosts: 0 };
    const baseHourly = totalCosts / billableHoursYear;
    const withBuffer = baseHourly * (1 + bufPct / 100);
    return {
      hourly: Math.round(withBuffer),
      monthly: Math.round(withBuffer * hWeek * 4),
      billableHoursYear,
      totalCosts,
    };
  }, [income, costs, hoursWeek, weeksYear, buffer]);

  async function save() {
    const id = await uuid();
    await hourly.insert({
      id, label: label.trim() || null,
      desired_annual_income_cents: parseMoneyToCents(income),
      business_costs_annual_cents: parseMoneyToCents(costs),
      billable_hours_per_week: parseFloat(hoursWeek) || 0,
      weeks_per_year: parseFloat(weeksYear) || 42,
      buffer_pct: parseFloat(buffer) || 0,
      result_hourly_rate_cents: result.hourly,
      created_at: new Date().toISOString(),
    });
    setLabel('');
    setHistory(await hourly.list());
  }

  async function remove(id: string) {
    await hourly.remove(id);
    setHistory(await hourly.list());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-medium text-ink-900">Stundensatz-Kalkulation</h1>
        <p className="text-sm text-ink-500 mt-0.5">Berechne deinen Mindest-Stundensatz</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Inputs */}
        <div className="card p-5 lg:col-span-3 space-y-4">
          <SectionHeader title="Eingaben" />
          <Field label="Gewünschtes Jahresnettoeinkommen (€)" hint="Was du netto für dich behalten willst">
            <input type="text" inputMode="decimal" className="input" value={income} onChange={(e) => setIncome(e.target.value)} />
          </Field>
          <Field label="Geschäftskosten pro Jahr (€)" hint="Software, Hosting, Steuerberater, Rücklagen">
            <input type="text" inputMode="decimal" className="input" value={costs} onChange={(e) => setCosts(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fakturierbare Std./Woche" hint="Nur Stunden, die du abrechnen kannst">
              <input type="number" className="input" value={hoursWeek} onChange={(e) => setHoursWeek(e.target.value)} />
            </Field>
            <Field label="Arbeitswochen/Jahr" hint="Abzgl. Urlaub, Krankheit, Akquise">
              <input type="number" className="input" value={weeksYear} onChange={(e) => setWeeksYear(e.target.value)} />
            </Field>
          </div>
          <Field label="Sicherheitspuffer (%)" hint="Puffer für Ausfallzeiten, Nachverhandlungen">
            <input type="number" className="input" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
        </div>

        {/* Result */}
        <div className="card p-5 lg:col-span-2 flex flex-col">
          <SectionHeader title="Ergebnis" />
          <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-500 mb-2">Dein Stundensatz</p>
            <p className="font-display text-4xl font-medium text-accent-700 tabular-nums">{formatMoney(result.hourly)}</p>
            <p className="text-sm text-ink-500 mt-2">≈ {formatMoney(result.monthly)} / Monat bei {hoursWeek} h/Woche</p>
          </div>
          <div className="space-y-2 text-sm border-t border-line pt-4">
            <div className="flex justify-between"><span className="text-ink-500">Jahreskosten gesamt</span><span className="font-medium tabular-nums">{formatMoney(result.totalCosts)}</span></div>
            <div className="flex justify-between"><span className="text-ink-500">Fakturierbare Std./Jahr</span><span className="font-medium tabular-nums">{result.billableHoursYear.toFixed(0)} h</span></div>
          </div>
          <div className="mt-4 flex gap-2">
            <input className="input flex-1" placeholder="Label (z.B. 2026 Q1)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button onClick={save} className="btn-primary"><Save size={15} /> Speichern</button>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="card p-4 bg-info-50/50 border-info-200/50 flex items-start gap-3">
        <Info size={18} className="text-info-600 shrink-0 mt-0.5" />
        <p className="text-sm text-ink-700">
          Der Stundensatz deckt Einkommen + Geschäftskosten + Puffer. Er ist das Minimum, um kostendeckend zu arbeiten —
          nicht dein Marktpreis. Marktpreis = Stundensatz × (1 + Gewinnaufschlag).
        </p>
      </div>

      {/* History */}
      <div className="card p-5">
        <SectionHeader title="Gespeicherte Kalkulationen" />
        {history.length === 0 ? (
          <EmptyState icon={<Calculator size={24} />} title="Noch keine Kalkulationen" hint="Speichere eine Berechnung, um sie hier zu sehen." />
        ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surfaceAlt group">
                <div className="w-9 h-9 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center">
                  <TrendingUp size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">{h.label || 'Unbenannte Kalkulation'}</p>
                  <p className="text-2xs text-ink-500">
                    {formatDate(h.created_at)} · {h.billable_hours_per_week}h/Woche · {h.weeks_per_year} Wochen · {h.buffer_pct}% Puffer
                  </p>
                </div>
                <Badge tone="accent">{formatMoney(h.result_hourly_rate_cents)} / h</Badge>
                <button onClick={() => remove(h.id)} className="p-1 text-ink-400 hover:text-danger-600 opacity-0 group-hover:opacity-100">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
