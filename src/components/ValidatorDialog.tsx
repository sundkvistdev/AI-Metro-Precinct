import React, { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { ValidationIssue, ValidationSeverity } from '../assets/packValidator';
import { DraggableResizableWindow } from './DraggableResizableWindow';

export interface ValidatorDialogProps {
  open: boolean;
  packName?: string;
  issues: ValidationIssue[];
  onClose: () => void;
  onJumpToIssue?: (issue: ValidationIssue) => void;
}

export const ValidatorDialog: React.FC<ValidatorDialogProps> = ({
  open,
  packName = 'Active Pack',
  issues,
  onClose,
  onJumpToIssue,
}) => {
  const [filter, setFilter] = useState<'all' | ValidationSeverity>('all');

  const counts = useMemo(() => {
    const c = { fatal: 0, error: 0, warning: 0 };
    for (const iss of issues) c[iss.severity]++;
    return c;
  }, [issues]);

  const visibleIssues = useMemo(
    () => (filter === 'all' ? issues : issues.filter((i) => i.severity === filter)),
    [issues, filter],
  );

  if (!open) return null;

  return (
    <DraggableResizableWindow
      title="Live Asset Pack Validator"
      subtitle={`${packName} · ${counts.fatal} fatal · ${counts.error} err · ${counts.warning} warn`}
      defaultSize={{ w: 620, h: 410 }}
      minSize={{ w: 380, h: 240 }}
      onClose={onClose}
      zIndex={72}
      borderTone={counts.fatal > 0 ? 'danger' : counts.error > 0 ? 'warning' : 'default'}
    >
      <div className="flex flex-col h-full p-2.5 gap-2 text-xs">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex border border-zinc-600 bg-zinc-900">
            {(
              [
                { id: 'all', label: `All (${issues.length})` },
                { id: 'fatal', label: `Fatal (${counts.fatal})` },
                { id: 'error', label: `Error (${counts.error})` },
                { id: 'warning', label: `Warning (${counts.warning})` },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilter(btn.id)}
                className={`px-2 py-0.5 text-[10px] font-mono-tabular whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                  filter === btn.id
                    ? 'bg-zinc-200 text-zinc-900 font-semibold'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <div className="text-[10px] font-mono-tabular text-zinc-400">
            Live schema & cross-reference checks
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto border border-zinc-600 bg-zinc-950/75 divide-y divide-zinc-800">
          {visibleIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-emerald-300">
              <CheckCircle2 className="h-6 w-6" />
              <div className="text-xs font-semibold">
                {issues.length === 0
                  ? 'All Pack V3 assets, maps, materials, models, lightbars & references validated cleanly.'
                  : 'No issues match selected severity filter.'}
              </div>
            </div>
          ) : (
            visibleIssues.map((issue) => {
              const badgeClass =
                issue.severity === 'fatal'
                  ? 'border-red-500/80 bg-red-950/70 text-red-300'
                  : issue.severity === 'error'
                  ? 'border-rose-500/70 bg-rose-950/50 text-rose-300'
                  : 'border-amber-500/70 bg-amber-950/40 text-amber-300';

              return (
                <div
                  key={issue.id}
                  className="flex items-start justify-between gap-2 px-2.5 py-2 hover:bg-zinc-900/70"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 font-mono-tabular text-[10px]">
                      <ShieldAlert className="h-3 w-3 shrink-0 text-amber-300" />
                      <span className={`border px-1 uppercase font-semibold ${badgeClass}`}>
                        {issue.severity}
                      </span>
                      <span className="border border-zinc-700 bg-zinc-800 px-1 uppercase text-zinc-300">
                        {issue.category}
                      </span>
                      <span className="text-zinc-200 font-semibold truncate">
                        {issue.assetId}
                      </span>
                      <span className="text-zinc-500 truncate">{issue.fieldPath}</span>
                    </div>
                    <div className="text-[11px] text-zinc-200 break-words">{issue.message}</div>
                  </div>

                  {onJumpToIssue && issue.jumpTab && (
                    <button
                      type="button"
                      onClick={() => onJumpToIssue(issue)}
                      className="flex items-center gap-0.5 border border-sky-500/70 bg-sky-700/35 px-2 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-600/60 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
                    >
                      Inspect
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
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
