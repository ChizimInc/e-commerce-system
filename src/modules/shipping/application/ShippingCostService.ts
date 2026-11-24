import type { Money } from '../../../shared';
import type { ShippingCostRequest, ShippingCostStrategies } from '../domain/ShippingCostStrategy';
import type { DeliveryMethod } from '../domain/ShippingTypes';
import type { ShippingCostQuotes } from '../ports/in/ShippingUseCases';

/** Alege strategia dupa metoda de livrare (la runtime) si o ruleaza prin contextul `ShippingCostCalculator`. */
export class ShippingCostService implements ShippingCostQuotes {
  constructor(private readonly strategies: ShippingCostStrategies) {}

  quote(method: DeliveryMethod, request: ShippingCostRequest): Money {
    return this.strategies.calculatorFor(method).calculate(request);
  }
}
