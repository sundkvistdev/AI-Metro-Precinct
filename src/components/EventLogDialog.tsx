import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import {
  SimEventCategory,
  SimEventEntry,
  simEventLog,
  SimEventSeverity,
} from '../assets/simEventLog';
import { DraggableResizableWindow } from './DraggableResizableWindow';

export interface EventLogDialogProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: Array<'all' | SimEventCategory> = [
  'all',
  'system',
  'dispatch',
  'combat',
  'traffic',
  'crash',
  'map',
  'asset',
  'validator',
  'audio',
];

export const EventLogDialog: React.FC<EventLogDialogProps> = ({ open, onClose }) => {
  const [entries, setEntries] = useState<SimEventEntry[]>(() => [
    ...simEventLog.getEntries(),
  ]);
  const [severityFilter, setSeverityFilter] = useState<
    'all' | 'fatal_error' | SimEventSeverity
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | SimEventCategory>('all');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEntries([...simEventLog.getEntries()]);
    return simEventLog.subscribe(() => {
      setEntries([...simEventLog.getEntries()]);
    });
  }, []);

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0, fatal: 0 };
    for (const e of entries) c[e.severity]++;
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries
      .filter((e) => {
        if (severityFilter === 'fatal_error') {
          if (e.severity !== 'fatal' && e.severity !== 'error') return false;
        } else if (severityFilter !== 'all' && e.severity !== severityFilter) {
          return false;
        }
        if (categoryFilter !== 'all' && e.category !== categoryFilter) {
          return false;
        }
        if (
          q &&
          !e.title.toLowerCase().includes(q) &&
          !e.message.toLowerCase().includes(q) &&
          !e.category.toLowerCase().includes(q) &&
          !(e.source ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .slice()
      .reverse();
  }, [entries, severityFilter, categoryFilter, search]);

  if (!open) return null;

  const handleCopy = async () => {
    const text = simEventLog.formatAsText(filtered.slice().reverse());
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <DraggableResizableWindow
      title="Simulation Event & Error Log"
      subtitle={`${entries.length} events · ${counts.fatal + counts.error} err · ${counts.warn} warn`}
      defaultSize={{ w: 660, h: 420 }}
      minSize={{ w: 420, h: 240 }}
      onClose={onClose}
      zIndex={70}
      borderTone={counts.fatal > 0 ? 'danger' : counts.error > 0 ? 'warning' : 'default'}
      headerActions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex items-center gap-1 border border-zinc-600 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 cursor-pointer rounded-none"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => simEventLog.clear()}
            className="flex items-center gap-1 border border-zinc-600 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-red-800/60 cursor-pointer rounded-none"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full p-2.5 gap-2 text-xs">
        {/* Filter Strip */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <div className="flex border border-zinc-600 bg-zinc-900">
            {(
              [
                { id: 'all', label: `All (${entries.length})` },
                { id: 'fatal_error', label: `Errors (${counts.fatal + counts.error})` },
                { id: 'warn', label: `Warn (${counts.warn})` },
                { id: 'info', label: `Info (${counts.info})` },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setSeverityFilter(btn.id)}
                className={`px-2 py-0.5 text-[10px] font-mono-tabular whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                  severityFilter === btn.id
                    ? 'bg-zinc-200 text-zinc-900 font-semibold'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | SimEventCategory)}
            className="border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[11px] font-mono-tabular text-zinc-100 rounded-none"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'all' ? 'All Categories' : cat.toUpperCase()}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter event text..."
            className="flex-1 min-w-[140px] border border-zinc-600 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-100 placeholder:text-zinc-500 rounded-none"
          />
        </div>

        {/* Color-Coded Scrollable Event Table */}
        <div className="flex-1 min-h-0 overflow-y-auto border border-zinc-600 bg-zinc-950/75 divide-y divide-zinc-800 font-mono-tabular text-[11px]">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-zinc-500">
              No logged events match the current filter.
            </div>
          ) : (
            filtered.map((entry) => {
              const sevColor =
                entry.severity === 'fatal'
                  ? 'text-red-400 bg-red-950/50 border-red-500/60'
                  : entry.severity === 'error'
                  ? 'text-rose-400 bg-rose-950/40 border-rose-500/50'
                  : entry.severity === 'warn'
                  ? 'text-amber-300 bg-amber-950/30 border-amber-500/40'
                  : 'text-sky-300 bg-zinc-800/70 border-zinc-600';

              const textTone =
                entry.severity === 'fatal'
                  ? 'text-red-200'
                  : entry.severity === 'error'
                  ? 'text-rose-200'
                  : entry.severity === 'warn'
                  ? 'text-amber-100'
                  : 'text-slate-200';

              return (
                <div key={entry.id} className="px-2 py-1 space-y-0.5 hover:bg-zinc-900/70">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-zinc-500 shrink-0">{entry.timestamp}</span>
                      <span className="text-zinc-500 shrink-0">
                        T+{entry.simTime.toFixed(1)}s
                      </span>
                      <span className={`border px-1 uppercase font-semibold shrink-0 ${sevColor}`}>
                        {entry.severity}
                      </span>
                      <span className="border border-zinc-700 bg-zinc-800 px-1 uppercase text-zinc-300 shrink-0">
                        {entry.category}
                      </span>
                      <span className={`font-semibold truncate ${textTone}`}>{entry.title}</span>
                    </div>
                    {entry.source && (
                      <span className="text-zinc-500 shrink-0 truncate max-w-[160px]">
                        {entry.source}
                      </span>
                    )}
                  </div>
                  {entry.message && (
                    <div className="text-[11px] text-zinc-300 pl-2 break-words">
                      {entry.message}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </DraggableResizableWindow>
  );
};
