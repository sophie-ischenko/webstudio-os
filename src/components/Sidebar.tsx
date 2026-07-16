import { type ReactNode } from 'react';
import {
  LayoutDashboard, FolderKanban, Clock, Wallet, Calculator,
  FileText, Calendar, Settings, Sparkles, Layers, Target, CheckSquare,
  Sun, Moon, BarChart3, Users, Building2, StickyNote, PiggyBank, Compass,
} from 'lucide-react';
import { useTheme } from '../lib/useTheme';
import { GlobalSearch } from './GlobalSearch';

export type ViewId =
  | 'dashboard' | 'projects' | 'time' | 'finances'
  | 'calculator' | 'invoices' | 'social' | 'templates' | 'settings'
  | 'pricecalc' | 'goals' | 'todos' | 'analytics'
  | 'clients' | 'suppliers' | 'notes' | 'reserves' | 'documents';

interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
  group: string;
}

const NAV: NavItem[] = [
  { id: 'dashboard',  label: 'Dashboard',   icon: <LayoutDashboard size={18} />, group: 'Übersicht' },
  { id: 'clients',    label: 'Kunden',      icon: <Users size={18} />,          group: 'Arbeit' },
  { id: 'projects',   label: 'Projekte',    icon: <FolderKanban size={18} />,    group: 'Arbeit' },
  { id: 'documents',  label: 'Dokumente',   icon: <FileText size={18} />,        group: 'Arbeit' },
  { id: 'time',       label: 'Zeiterfassung', icon: <Clock size={18} />,         group: 'Arbeit' },
  { id: 'social',     label: 'Social Planer', icon: <Calendar size={18} />,      group: 'Arbeit' },
  { id: 'analytics',  label: 'Analytics',    icon: <BarChart3 size={18} />,      group: 'Arbeit' },
  { id: 'todos',      label: 'To-dos',      icon: <CheckSquare size={18} />,     group: 'Arbeit' },
  { id: 'templates',  label: 'Vorlagen',    icon: <Layers size={18} />,          group: 'Arbeit' },
  { id: 'notes',      label: 'Notizen',     icon: <StickyNote size={18} />,       group: 'Arbeit' },
  { id: 'finances',   label: 'Finanzen',    icon: <Wallet size={18} />,          group: 'Geld' },
  { id: 'invoices',   label: 'Rechnungen',  icon: <FileText size={18} />,        group: 'Geld' },
  { id: 'calculator', label: 'Stundensatz', icon: <Calculator size={18} />,      group: 'Geld' },
  { id: 'pricecalc',  label: 'Projektpreis', icon: <Calculator size={18} />,      group: 'Geld' },
  { id: 'reserves',   label: 'Rücklagen',   icon: <PiggyBank size={18} />,       group: 'Geld' },
  { id: 'goals',      label: 'Zielplaner',  icon: <Target size={18} />,          group: 'Geld' },
  { id: 'suppliers',  label: 'Tool-Abos', icon: <Building2 size={18} />,       group: 'Geld' },
  { id: 'settings',   label: 'Einstellungen', icon: <Settings size={18} />,      group: 'System' },
];

interface SidebarProps {
  active: ViewId;
  onNavigate: (id: ViewId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const groups = Array.from(new Set(NAV.map(n => n.group)));
  const { theme, toggle } = useTheme();
  return (
    <aside className="w-60 shrink-0 bg-surface border-r border-line flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-accent-600 flex items-center justify-center text-white shadow-soft">
          <Compass size={18} />
        </div>
        <div>
          <p className="font-display text-base font-semibold text-ink-900 leading-none">Studio OS</p>
          <p className="text-2xs text-ink-400 mt-0.5">Arbeitsraum</p>
        </div>
      </div>

      {/* Global search */}
      <div className="px-3 pb-3">
        <GlobalSearch onNavigate={(v) => onNavigate(v as ViewId)} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 no-scrollbar">
        {groups.map(g => (
          <div key={g} className="mb-4">
            <p className="px-3 mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">{g}</p>
            <div className="space-y-0.5">
              {NAV.filter(n => n.group === g).map(item => {
                const isActive = item.id === active;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150
                      ${isActive
                        ? 'bg-accent-50 text-accent-700'
                        : 'text-ink-700 hover:bg-surfaceAlt hover:text-ink-900'}`}
                  >
                    <span className={isActive ? 'text-accent-600' : 'text-ink-400'}>{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer status + theme toggle */}
      <div className="px-4 py-3 border-t border-line flex items-center justify-between">
        <div className="flex items-center gap-2 text-2xs text-ink-400">
          <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse-soft" />
          Lokale Datenbank aktiv
        </div>
        <button
          onClick={toggle}
          className="p-1.5 rounded-lg text-ink-500 hover:bg-surfaceAlt hover:text-ink-900 transition-colors"
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </aside>
  );
}
