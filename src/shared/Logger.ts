export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

/** Port de logging: domeniul si aplicatia depind doar de aceasta interfata. */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Un logger nou care adauga `bindings` la fiecare intrare (ex. `{ module: 'ordering' }`). */
  child(bindings: LogContext): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/** Logger simplu: o linie JSON per intrare, filtrata dupa nivelul minim. */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly bindings: LogContext = {},
    private readonly sink: LogSink = defaultSink,
  ) {}

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  child(bindings: LogContext): Logger {
    return new ConsoleLogger(this.minLevel, { ...this.bindings, ...bindings }, this.sink);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...context,
    };
    this.sink(level, JSON.stringify(entry, jsonReplacer));
  }
}
