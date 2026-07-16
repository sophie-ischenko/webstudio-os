import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { useState } from 'react';
// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${widths[size]} bg-surface rounded-2xl shadow-pop animate-scale-in max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="font-display text-lg font-medium text-ink-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-500 hover:bg-surfaceAlt hover:text-ink-900 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line bg-surfaceAlt/50 rounded-b-2xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge / Chip
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surfaceMuted text-ink-700',
  accent: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-700',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip ${toneClasses[tone]}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      {icon && <div className="mb-3 p-3 rounded-2xl bg-surfaceAlt text-ink-400">{icon}</div>}
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-500 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-2xs text-ink-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog (inline, lightweight)
// ---------------------------------------------------------------------------

export function ConfirmInline({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink-700 flex-1">{message}</span>
      <button className="btn-danger" onClick={onConfirm}>Löschen</button>
      <button className="btn-ghost" onClick={onCancel}>Abbrechen</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money input with proper formatting
// ---------------------------------------------------------------------------

export function MoneyInput({ valueCents, onChange, placeholder, className = 'input' }: {
  valueCents: number;
  onChange: (cents: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [raw, setRaw] = useState<string | null>(null);

  const display = raw !== null ? raw : (valueCents ? (valueCents / 100).toFixed(2).replace('.', ',') : '');

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val === '' || /^[\d.,]+$/.test(val)) {
      setRaw(val);
    }
  }

  function handleBlur() {
    if (raw !== null) {
      const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      onChange(isNaN(n) ? 0 : Math.round(n * 100));
      setRaw(null);
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}