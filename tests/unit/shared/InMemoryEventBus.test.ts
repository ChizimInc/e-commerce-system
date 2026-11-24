import { describe, expect, it } from 'vitest';
import { ConsoleLogger, InMemoryEventBus, type DomainEvent } from '../../../src/shared';

interface Ping extends DomainEvent {
  readonly type: 'Ping';
  readonly n: number;
}
interface Pong extends DomainEvent {
  readonly type: 'Pong';
}

const ping = (n: number): Ping => ({ type: 'Ping', occurredAt: new Date(), n });
const pong = (): Pong => ({ type: 'Pong', occurredAt: new Date() });

const setup = () => {
  const lines: string[] = [];
  const logger = new ConsoleLogger('debug', {}, (_level, line) => lines.push(line));
  return { bus: new InMemoryEventBus(logger), lines };
};

/** Observer (B3): subiectul publica, abonatii reactioneaza, fara sa se cunoasca intre ei. */
describe('InMemoryEventBus (Observer)', () => {
  it('livreaza evenimentul tuturor abonatilor tipului, in ordinea abonarii', async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe<Ping>('Ping', () => {
      seen.push('primul');
    });
    bus.subscribe<Ping>('Ping', (event) => {
      seen.push(`al doilea:${event.n}`);
    });

    await bus.publish(ping(7));

    expect(seen).toEqual(['primul', 'al doilea:7']);
  });

  it('un abonat primeste doar tipul la care s-a abonat', async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe<Pong>('Pong', (event) => {
      seen.push(event.type);
    });
    await bus.publish(ping(1));
    expect(seen).toEqual([]);
    await bus.publish(pong());
    expect(seen).toEqual(['Pong']);
  });

  it('un eveniment fara abonati nu e o eroare', async () => {
    await expect(setup().bus.publish(ping(1))).resolves.toBeUndefined();
  });

  it('eroarea unui abonat (sincrona sau asincrona) nu opreste ceilalti si nu ajunge la cel care publica', async () => {
    const { bus, lines } = setup();
    const seen: string[] = [];
    bus.subscribe<Ping>('Ping', () => {
      throw new Error('sincrona');
    });
    bus.subscribe<Ping>('Ping', () => Promise.reject(new Error('asincrona')));
    bus.subscribe<Ping>('Ping', () => {
      seen.push('ajuns');
    });

    await expect(bus.publish(ping(1))).resolves.toBeUndefined();

    expect(seen).toEqual(['ajuns']);
    const logged = lines.map((line) => JSON.parse(line) as { level: string; eventType: string });
    expect(logged).toHaveLength(2);
    expect(logged.every((entry) => entry.level === 'error' && entry.eventType === 'Ping')).toBe(
      true,
    );
  });

  it('un abonat asincron e asteptat inainte de urmatorul (livrare ordonata)', async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe<Ping>('Ping', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push('lent');
    });
    bus.subscribe<Ping>('Ping', () => {
      seen.push('rapid');
    });
    await bus.publish(ping(1));
    expect(seen).toEqual(['lent', 'rapid']);
  });

  it('dezabonarea opreste livrarea doar pentru acel abonat (si e sigura de apelat de doua ori)', async () => {
    const { bus } = setup();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe<Ping>('Ping', () => {
      seen.push('a');
    });
    bus.subscribe<Ping>('Ping', () => {
      seen.push('b');
    });
    unsubscribe();
    unsubscribe();
    await bus.publish(ping(1));
    expect(seen).toEqual(['b']);
  });

  it('un abonat care se dezaboneaza in timpul livrarii nu strica runda curenta', async () => {
    const { bus } = setup();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe<Ping>('Ping', () => {
      seen.push('a');
      unsubscribe();
    });
    bus.subscribe<Ping>('Ping', () => {
      seen.push('b');
    });
    await bus.publish(ping(1));
    await bus.publish(ping(2));
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});
