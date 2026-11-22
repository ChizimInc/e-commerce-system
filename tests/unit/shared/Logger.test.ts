import { describe, expect, it } from 'vitest';
import { ConsoleLogger, type LogLevel } from '../../../src/shared';

function capture(minLevel?: LogLevel) {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = new ConsoleLogger(minLevel, {}, (level, line) => {
    lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> });
  });
  return { logger, lines };
}

describe('ConsoleLogger', () => {
  it('scrie o linie JSON cu nivel, mesaj, timp si context', () => {
    const { logger, lines } = capture();
    logger.info('Comanda creata', { orderId: 'o-1' });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.entry).toMatchObject({
      level: 'info',
      message: 'Comanda creata',
      orderId: 'o-1',
    });
    expect(typeof lines[0]?.entry['time']).toBe('string');
  });

  it('ignora mesajele sub nivelul minim', () => {
    const { logger, lines } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('nivelul implicit este info (debug e ignorat)', () => {
    const { logger, lines } = capture();
    logger.debug('d');
    logger.info('i');
    expect(lines.map((l) => l.level)).toEqual(['info']);
  });

  it('child() adauga bindings la fiecare intrare, fara a modifica parintele', () => {
    const { logger, lines } = capture();
    const child = logger.child({ module: 'ordering' });
    child.info('din copil');
    logger.info('din parinte');
    expect(lines[0]?.entry['module']).toBe('ordering');
    expect(lines[1]?.entry['module']).toBeUndefined();
  });

  it('serializeaza erorile (nume, mesaj, stack)', () => {
    const { logger, lines } = capture();
    logger.error('eroare', { error: new Error('boom') });
    expect(lines[0]?.entry['error']).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('serializeaza bigint ca string', () => {
    const { logger, lines } = capture();
    logger.info('big', { value: 10n });
    expect(lines[0]?.entry['value']).toBe('10');
  });
});
