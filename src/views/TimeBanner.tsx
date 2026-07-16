import { useRunningTimer, stopAndSave, formatElapsed } from '../lib/timer';
import { Square } from 'lucide-react';

export function TimerBanner() {
  const running = useRunningTimer();
  if (!running) return null;

  const entityLabel = running.entityType === 'project'
    ? 'Projekt'
    : running.entityType === 'project_phase'
    ? 'Projektphase'
    : running.entityType === 'social_post'
    ? 'Social Post'
    : running.entityType;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
      <div className="card bg-accent-50 border-accent-200 shadow-lg px-5 py-3.5 flex items-center gap-4 min-w-[280px]">
        <span className="w-2.5 h-2.5 rounded-full bg-accent-500 animate-pulse-soft shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-accent-800">Timer läuft</p>
          <p className="text-2xs text-accent-600 truncate">
            {entityLabel}{running.note ? ` · ${running.note}` : ''}
          </p>
        </div>
        <span className="font-mono text-base font-medium text-accent-800 tabular-nums">
          {formatElapsed()}
        </span>
        <button onClick={() => stopAndSave()} className="btn-primary !py-1.5 !px-3 text-sm">
          <Square size={13} /> Stop
        </button>
      </div>
    </div>
  );
}