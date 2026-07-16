import { useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Generic Kanban board — native HTML5 drag & drop, no external dependency.
// Columns are defined by the caller (status values); cards are rendered via
// a render-prop so this stays reusable across Phasen and Todos.
// ---------------------------------------------------------------------------

export interface KanbanColumn<S extends string> {
  id: S;
  label: string;
  colorClass?: string; // e.g. 'bg-accent-500' — used for the small column dot
}

export interface KanbanCardBase {
  id: string;
}

interface KanbanBoardProps<S extends string, C extends KanbanCardBase> {
  columns: KanbanColumn<S>[];
  cards: C[];
  getStatus: (card: C) => S;
  onMove: (card: C, newStatus: S) => void;
  renderCard: (card: C, isDragging: boolean) => ReactNode;
  emptyHint?: string;
}

export function KanbanBoard<S extends string, C extends KanbanCardBase>({
  columns, cards, getStatus, onMove, renderCard, emptyHint,
}: KanbanBoardProps<S, C>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<S | null>(null);

  const byColumn = (colId: S) => cards.filter(c => getStatus(c) === colId);

  function handleDrop(e: React.DragEvent, colId: S) {
    e.preventDefault();
    setOverColumn(null);
    const cardId = e.dataTransfer.getData('text/plain');
    const card = cards.find(c => c.id === cardId);
    if (card && getStatus(card) !== colId) {
      onMove(card, colId);
    }
    setDraggingId(null);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
      {columns.map(col => {
        const colCards = byColumn(col.id);
        const isOver = overColumn === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); setOverColumn(col.id); }}
            onDragLeave={() => setOverColumn(prev => (prev === col.id ? null : prev))}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`shrink-0 w-72 rounded-xl border transition-colors ${isOver ? 'border-accent-400 bg-accent-50/40' : 'border-line bg-surfaceAlt/30'}`}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
              <span className={`w-2 h-2 rounded-full ${col.colorClass || 'bg-ink-300'}`} />
              <span className="text-sm font-semibold text-ink-900">{col.label}</span>
              <span className="ml-auto text-2xs text-ink-400 tabular-nums bg-surfaceMuted px-1.5 py-0.5 rounded">
                {colCards.length}
              </span>
            </div>

            <div className="p-2 space-y-2 min-h-[80px]">
              {colCards.length === 0 ? (
                <p className="text-2xs text-ink-400 text-center py-6 px-2">{emptyHint || 'Keine Karten'}</p>
              ) : (
                colCards.map(card => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', card.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingId(card.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`cursor-grab active:cursor-grabbing transition-opacity ${draggingId === card.id ? 'opacity-40' : 'opacity-100'}`}
                  >
                    {renderCard(card, draggingId === card.id)}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
