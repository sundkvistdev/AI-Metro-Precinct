export type SimEventSeverity = 'info' | 'warn' | 'error' | 'fatal';

export type SimEventCategory =
  | 'system'
  | 'dispatch'
  | 'combat'
  | 'traffic'
  | 'crash'
  | 'map'
  | 'asset'
  | 'validator'
  | 'audio';

export interface SimEventEntry {
  id: number;
  timestamp: string;
  simTime: number;
  severity: SimEventSeverity;
  category: SimEventCategory;
  title: string;
  message: string;
  source?: string;
}

const MAX_LOG_ENTRIES = 600;

class SimEventLogStore {
  private entries: SimEventEntry[] = [];
  private nextId = 1;
  private listeners = new Set<() => void>();
  private currentSimTime = 0;

  public setSimTime(simTime: number): void {
    this.currentSimTime = simTime;
  }

  public log(
    severity: SimEventSeverity,
    category: SimEventCategory,
    title: string,
    message = '',
    source?: string,
    simTimeOverride?: number,
  ): SimEventEntry {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const entry: SimEventEntry = {
      id: this.nextId++,
      timestamp: `${hh}:${mm}:${ss}`,
      simTime: simTimeOverride ?? this.currentSimTime,
      severity,
      category,
      title,
      message,
      source,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES);
    }
    if (severity === 'fatal' || severity === 'error') {
      console.error(
        message
          ? `[${category.toUpperCase()}] ${title}: ${message}`
          : `[${category.toUpperCase()}] ${title}`,
      );
    }
    this.emit();
    return entry;
  }

  public info(
    category: SimEventCategory,
    title: string,
    message = '',
    source?: string,
  ): void {
    this.log('info', category, title, message, source);
  }

  public warn(
    category: SimEventCategory,
    title: string,
    message = '',
    source?: string,
  ): void {
    this.log('warn', category, title, message, source);
  }

  public error(
    category: SimEventCategory,
    title: string,
    message = '',
    source?: string,
  ): void {
    this.log('error', category, title, message, source);
  }

  public fatal(
    category: SimEventCategory,
    title: string,
    message = '',
    source?: string,
  ): void {
    this.log('fatal', category, title, message, source);
  }

  public getEntries(): SimEventEntry[] {
    return this.entries;
  }

  public getCounts(): Record<SimEventSeverity, number> {
    const counts: Record<SimEventSeverity, number> = {
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    };
    for (const e of this.entries) {
      counts[e.severity]++;
    }
    return counts;
  }

  public clear(): void {
    this.entries = [];
    this.emit();
  }

  public formatAsText(entries: SimEventEntry[] = this.entries): string {
    return entries
      .map((e) => {
        const msgPart = e.message ? `: ${e.message}` : '';
        return `[${e.timestamp} | T+${e.simTime.toFixed(1)}s] [${e.severity.toUpperCase()}] [${e.category.toUpperCase()}] ${e.title}${msgPart}${e.source ? ` (${e.source})` : ''}`;
      })
      .join('\n');
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}

export const simEventLog = new SimEventLogStore();
