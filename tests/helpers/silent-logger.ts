import { ConsoleLogger, type Logger } from '../../src/shared';

/** Logger care nu scrie nimic (testele nu trebuie sa polueze consola). */
export const silentLogger: Logger = new ConsoleLogger('error', {}, () => undefined);
