import { DomainError } from '../../../shared';
import type { NotificationChannel } from './NotificationChannel';
import type { ChannelType } from './NotificationTypes';

// Pattern: Factory Method (Creational) – creatorul abstract: `createChannel()` e metoda-fabrica pe care o implementeaza subclasele, iar `channel()` e operatia creatorului care o foloseste; codul client lucreaza doar cu `NotificationChannel`
export abstract class NotificationChannelFactory {
  /** Tipul de canal pe care il produce aceasta fabrica (cheia dupa care se alege, la runtime, din preferintele clientului). */
  abstract readonly type: ChannelType;

  /** Metoda-fabrica: fiecare subclasa creeaza canalul ei. */
  abstract createChannel(): NotificationChannel;

  /**
   * Operatia creatorului: cere canalul metodei-fabrica si verifica ca e cel promis de `type`. O fabrica care ar produce
   * alt canal decat cel anuntat ar trimite pe alt mediu decat cel ales de client si ar strica istoricul, fara nicio eroare.
   */
  channel(): NotificationChannel {
    const channel = this.createChannel();
    if (channel.type !== this.type) {
      throw new DomainError(
        `Fabrica ${this.type} a produs un canal ${channel.type}`,
        'INVALID_CHANNELS',
      );
    }
    return channel;
  }
}
