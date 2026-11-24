/** Port pentru "acum": codul care depinde de timp primeste un ceas, ca testele sa-l poata controla. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
