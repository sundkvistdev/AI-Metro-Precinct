import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AssetIssue } from '../assets/assetTypes';
import { DraggableResizableWindow } from './DraggableResizableWindow';

export interface ErrorDialogProps {
  open: boolean;
  fatalError: string | null;
  issues: AssetIssue[];
  sourceLabel: string;
  onDismiss: () => void;
  onReloadDefault: () => void;
}

export const ErrorDialog: React.FC<ErrorDialogProps> = ({
  open,
  fatalError,
  issues,
  sourceLabel,
  onDismiss,
  onReloadDefault,
}) => {
  if (!open || (!fatalError && issues.length === 0)) {
    return null;
  }

  return (
    <DraggableResizableWindow
      title={fatalError ? 'Fatal Asset Error' : 'Asset Diagnostic Log'}
      subtitle={`${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`}
      defaultSize={{ w: 560, h: 400 }}
      minSize={{ w: 360, h: 240 }}
      onClose={fatalError ? undefined : onDismiss}
      closeDisabled={Boolean(fatalError)}
      zIndex={80}
      borderTone={fatalError ? 'danger' : 'warning'}
    >
      <div className="flex flex-col h-full p-3 gap-2.5 text-xs">
        <div className="flex items-center justify-between border border-zinc-600 bg-zinc-700/60 px-2.5 py-1.5 font-mono-tabular text-zinc-300 shrink-0">
          <span className="flex items-center gap-1.5 truncate">
            <AlertTriangle
              className={`h-3.5 w-3.5 shrink-0 ${
                fatalError ? 'text-red-400' : 'text-amber-300'
              }`}
            />
            <span className="truncate">Source: {sourceLabel}</span>
          </span>
          <span className="shrink-0">
            {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
          </span>
        </div>

        {fatalError && (
          <div className="border border-red-500/70 bg-red-950/50 p-2.5 text-red-200 shrink-0">
            <p className="font-semibold">
              Required engine configuration failed to load. Simulation launch is blocked.
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-red-300 break-all">
              {fatalError}
            </p>
          </div>
        )}

        {!fatalError && (
          <p className="text-zinc-300 shrink-0">
            Missing or malformed visual assets were replaced with magenta fallback placeholders
            and logged to the Simulation Event Log.
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto border border-zinc-600 bg-zinc-900/65 divide-y divide-zinc-700">
          {issues.map((issue, idx) => (
            <div key={`${issue.category}-${issue.id}-${idx}`} className="px-2.5 py-1.5 space-y-0.5">
              <div className="flex items-center justify-between gap-2 font-mono-tabular">
                <span
                  className={`uppercase font-semibold ${
                    issue.severity === 'fatal' ? 'text-red-400' : 'text-amber-300'
                  }`}
                >
                  [{issue.severity}] {issue.category}:{issue.id}
                </span>
                <span className="truncate text-[11px] text-zinc-400">{issue.path}</span>
              </div>
              <p className="text-zinc-200 break-words">{issue.message}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-600 pt-2 shrink-0">
          <button
            type="button"
            onClick={onReloadDefault}
            className="flex items-center gap-1.5 border border-zinc-500 bg-zinc-700 px-3 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload Built-in Pack
          </button>
          {!fatalError && (
            <button
              type="button"
              onClick={onDismiss}
              className="border border-blue-400/70 bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </DraggableResizableWindow>
  );
};
