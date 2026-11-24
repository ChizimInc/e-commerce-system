import { describe, expect, it } from 'vitest';
import { Money } from '../../../src/shared';
import {
  AbstractCheckoutValidator,
  chainOf,
  type CheckoutContext,
} from '../../../src/modules/ordering/application/validation/CheckoutValidator';
import {
  AddressValidator,
  AmountLimitValidator,
  FraudCheckValidator,
  StockValidator,
} from '../../../src/modules/ordering/application/validation/validators';
import type { OrderableItem } from '../../../src/modules/ordering/ports/out/OrderCatalog';
import type { OrderRepository } from '../../../src/modules/ordering/ports/out/OrderRepository';
import { makeAddress, makeLine, makeOrder } from '../../helpers/order-fixtures';
import { uuid } from '../../helpers/ids';

const orderableItem = (availableStock: number): OrderableItem => ({
  id: uuid(1),
  name: 'Tastatura',
  unitPrice: Money.of(10_000, 'RON'),
  availableStock,
  stockPerUnit: [{ productId: uuid(1), quantity: 1 }],
});

const context = (overrides: Partial<CheckoutContext> = {}): CheckoutContext => ({
  order: makeOrder(), // 2 x 100.00 RON, adresa din MD
  lines: [{ item: orderableItem(10), quantity: 2 }],
  ...overrides,
});

/** Veriga de proba: noteaza ca a rulat si, optional, refuza comanda. */
class Probe extends AbstractCheckoutValidator {
  constructor(
    private readonly name: string,
    private readonly log: string[],
    private readonly failWith?: Error,
  ) {
    super();
  }

  protected check(): void {
    this.log.push(this.name);
    if (this.failWith) throw this.failWith;
  }
}

/** Chain of Responsibility (B5): fiecare veriga isi face treaba si paseaza mai departe, sau opreste lantul. */
describe('lantul de validare (Chain of Responsibility)', () => {
  describe('mecanismul lantului', () => {
    it('ruleaza verigile in ordinea in care au fost legate', async () => {
      const log: string[] = [];
      const head = chainOf(new Probe('a', log), new Probe('b', log), new Probe('c', log));
      await head.validate(context());
      expect(log).toEqual(['a', 'b', 'c']);
    });

    it('o veriga care refuza opreste lantul: cele urmatoare nu mai ruleaza', async () => {
      const log: string[] = [];
      const head = chainOf(
        new Probe('a', log),
        new Probe('b', log, new Error('refuzat de b')),
        new Probe('c', log),
      );
      await expect(head.validate(context())).rejects.toThrowError('refuzat de b');
      expect(log).toEqual(['a', 'b']);
    });

    it('o veriga noua se adauga fara sa se modifice celelalte (si poate fi intercalata)', async () => {
      const log: string[] = [];
      await chainOf(new Probe('a', log), new Probe('c', log)).validate(context());
      log.length = 0;
      await chainOf(new Probe('a', log), new Probe('nou', log), new Probe('c', log)).validate(
        context(),
      );
      expect(log).toEqual(['a', 'nou', 'c']);
    });

    it('un lant cu o singura veriga functioneaza; setNext() intoarce veriga legata', async () => {
      const log: string[] = [];
      await chainOf(new Probe('singura', log)).validate(context());
      expect(log).toEqual(['singura']);

      const first = new Probe('1', log);
      const second = new Probe('2', log);
      expect(first.setNext(second)).toBe(second);
    });

    it('verigile asincrone sunt asteptate inainte de urmatoarea', async () => {
      const log: string[] = [];
      class Slow extends AbstractCheckoutValidator {
        protected async check(): Promise<void> {
          await new Promise((resolve) => setTimeout(resolve, 5));
          log.push('lenta');
        }
      }
      await chainOf(new Slow(), new Probe('dupa', log)).validate(context());
      expect(log).toEqual(['lenta', 'dupa']);
    });
  });

  describe('StockValidator (409)', () => {
    it('trece cand stocul acopera cantitatea (inclusiv exact)', async () => {
      await expect(new StockValidator().validate(context())).resolves.toBeUndefined();
      await expect(
        new StockValidator().validate(
          context({ lines: [{ item: orderableItem(2), quantity: 2 }] }),
        ),
      ).resolves.toBeUndefined();
    });

    it('refuza cu 409 INSUFFICIENT_STOCK si numeste produsul', async () => {
      await expect(
        new StockValidator().validate(
          context({ lines: [{ item: orderableItem(1), quantity: 2 }] }),
        ),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        message: expect.stringContaining('Tastatura') as string,
      });
    });
  });

  describe('AddressValidator (422)', () => {
    it('accepta o tara din lista (fara diferenta intre litere mari/mici in configurare)', async () => {
      await expect(new AddressValidator(['md', 'RO']).validate(context())).resolves.toBeUndefined();
    });

    it('refuza o tara nelivrabila cu UNSUPPORTED_COUNTRY', async () => {
      const order = makeOrder({ address: makeAddress({ country: 'US' }) });
      await expect(
        new AddressValidator(['MD', 'RO']).validate(context({ order })),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_COUNTRY' });
    });

    it('o lista goala inseamna ca nu livram nicaieri', async () => {
      await expect(new AddressValidator([]).validate(context())).rejects.toMatchObject({
        code: 'UNSUPPORTED_COUNTRY',
      });
    });
  });

  describe('AmountLimitValidator (422)', () => {
    it('trece cand totalul e sub limita sau exact egal cu ea', async () => {
      // totalul comenzii de proba: 20.000 cenți
      await expect(new AmountLimitValidator(20_000).validate(context())).resolves.toBeUndefined();
    });

    it('refuza cu AMOUNT_LIMIT_EXCEEDED cand totalul depaseste limita', async () => {
      await expect(new AmountLimitValidator(19_999).validate(context())).rejects.toMatchObject({
        code: 'AMOUNT_LIMIT_EXCEEDED',
      });
    });

    it('se uita la totalul cu TVA, nu doar la subtotal', async () => {
      const order = makeOrder({
        lines: [makeLine({ unitPrice: Money.of(10_000, 'RON'), quantity: 1 })],
        pricing: { vatPercent: 19, discountTiers: [] },
      }); // subtotal 10.000, total 11.900
      await expect(
        new AmountLimitValidator(11_000).validate({ order, lines: [] }),
      ).rejects.toMatchObject({ code: 'AMOUNT_LIMIT_EXCEEDED' });
    });
  });

  describe('FraudCheckValidator (429 / 422)', () => {
    const NOW = new Date('2026-06-01T12:00:00.000Z');
    const rules = { maxOrdersPerWindow: 3, windowMs: 10 * 60_000, suspiciousAmountCents: 50_000 };

    /** Istoric simulat: cate comenzi a plasat clientul; noteaza de la ce moment s-a cerut numaratoarea. */
    const history = (recent: number) => {
      const asked: { customerId: string; since: Date }[] = [];
      const orders: Pick<OrderRepository, 'countByCustomerSince'> = {
        countByCustomerSince: (customerId, since) => {
          asked.push({ customerId, since });
          return Promise.resolve(recent);
        },
      };
      return { orders, asked };
    };

    it('trece pentru un client cu putine comenzi si o suma obisnuita', async () => {
      const { orders, asked } = history(2);
      await new FraudCheckValidator(orders, rules, () => NOW).validate(context());
      // fereastra: ultimele 10 minute, pentru clientul comenzii
      expect(asked).toEqual([
        { customerId: makeOrder().customerId, since: new Date('2026-06-01T11:50:00.000Z') },
      ]);
    });

    it('prea multe comenzi in interval: 429 ORDER_RATE_LIMITED (a (N+1)-a e refuzata)', async () => {
      const { orders } = history(3);
      const error: unknown = await new FraudCheckValidator(orders, rules, () => NOW)
        .validate(context())
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'ORDER_RATE_LIMITED', name: 'TooManyRequestsError' });
    });

    it('suma neobisnuita: 422 ORDER_FLAGGED, fara sa mai numere comenzile; pragul exact trece', async () => {
      const { orders, asked } = history(0);
      const big = makeOrder({
        lines: [makeLine({ unitPrice: Money.of(50_001, 'RON'), quantity: 1 })],
      });
      await expect(
        new FraudCheckValidator(orders, rules, () => NOW).validate({ order: big, lines: [] }),
      ).rejects.toMatchObject({ code: 'ORDER_FLAGGED' });
      expect(asked).toHaveLength(0);

      const exact = makeOrder({
        lines: [makeLine({ unitPrice: Money.of(50_000, 'RON'), quantity: 1 })],
      });
      await expect(
        new FraudCheckValidator(orders, rules, () => NOW).validate({ order: exact, lines: [] }),
      ).resolves.toBeUndefined();
    });

    it('mesajele nu dezvaluie pragurile regulilor', async () => {
      const { orders } = history(99);
      const limited: unknown = await new FraudCheckValidator(orders, rules, () => NOW)
        .validate(context())
        .catch((e: unknown) => e);
      expect((limited as Error).message).not.toMatch(/\d/);
    });
  });

  describe('lantul complet, in ordinea din cerinta', () => {
    const build = (recent = 0) =>
      chainOf(
        new StockValidator(),
        new AddressValidator(['MD']),
        new AmountLimitValidator(25_000),
        new FraudCheckValidator(
          { countByCustomerSince: () => Promise.resolve(recent) },
          { maxOrdersPerWindow: 1, windowMs: 60_000, suspiciousAmountCents: 22_000 },
        ),
      );

    it('o comanda valida trece prin toate verigile', async () => {
      await expect(build().validate(context())).resolves.toBeUndefined();
    });

    it('prima veriga care refuza decide eroarea (stocul bate frauda, chiar daca ambele ar refuza)', async () => {
      await expect(
        build(5).validate(context({ lines: [{ item: orderableItem(0), quantity: 2 }] })),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      await expect(build(5).validate(context())).rejects.toMatchObject({
        code: 'ORDER_RATE_LIMITED',
      });
    });
  });
});
