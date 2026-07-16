import { useState, useEffect } from 'react';
import { Sidebar, type ViewId } from './components/Sidebar';
import { TimerBanner } from './components/TimerBanner';
import { DashboardView } from './views/DashboardView';
import { ProjectsView } from './views/ProjectsView';
import { TimeView } from './views/TimeView';
import { FinancesView } from './views/FinancesView';
import { CalculatorView } from './views/CalculatorView';
import { InvoicesView } from './views/InvoicesView';
import { SocialView } from './views/SocialView';
import { AnalyticsView } from './views/AnalyticsView';
import { SettingsView } from './views/SettingsView';
import { TemplatesView } from './views/TemplatesView';
import { ProjectCalculatorView } from './views/ProjectCalculatorView';
import { GoalsView } from './views/GoalsView';
import { TodosView } from './views/TodosView';
import { ClientsView } from './views/ClientsView';
import { SuppliersView } from './views/SuppliersView';
import { NotesView } from './views/NotesView';
import { ReservesView } from './views/ReservesView';
import { DocumentsView } from './views/DocumentsView';



function App() {
  const [view, setView] = useState<ViewId>('dashboard');

  // Global keyboard shortcuts
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Nur wenn kein Input/Textarea/Select fokussiert ist
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const shortcuts: Record<string, ViewId> = {
        '1': 'dashboard', '2': 'clients', '3': 'projects', '4': 'time',
        '5': 'social', '6': 'finances', '7': 'invoices', '8': 'todos',
        '9': 'analytics', 'n': 'notes', 's': 'suppliers', 'r': 'reserves',
        ',': 'settings',
      };
      const target = shortcuts[e.key];
      if (target) { e.preventDefault(); setView(target); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar active={view} onNavigate={setView} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8 animate-fade-in">
          {view === 'dashboard' && <DashboardView onNavigate={setView} />}
          {view === 'clients' && <ClientsView />}
          {view === 'projects' && <ProjectsView />}
          {view === 'time' && <TimeView />}
          {view === 'finances' && <FinancesView />}
          {view === 'calculator' && <CalculatorView />}
          {view === 'documents' && <DocumentsView />}
          {view === 'invoices' && <InvoicesView />}
          {view === 'social' && <SocialView />}
          {view === 'templates' && <TemplatesView />}
          {view === 'pricecalc' && <ProjectCalculatorView />}
          {view === 'goals' && <GoalsView />}
          {view === 'todos' && <TodosView />}
          {view === 'analytics' && <AnalyticsView />}
          {view === 'suppliers' && <SuppliersView />}
          {view === 'notes' && <NotesView />}
          {view === 'reserves' && <ReservesView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
      <TimerBanner />
    </div>
  );
}

export default App;
