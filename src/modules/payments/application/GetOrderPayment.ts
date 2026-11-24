import { NotFoundError, type Principal } from '../../../shared';
import type { Payment } from '../domain/Payment';
import type { GetOrderPaymentUseCase } from '../ports/in/PaymentUseCases';
import type { PayableOrders } from '../ports/out/PayableOrders';
import type { PaymentRepository } from '../ports/out/PaymentRepository';

/** Starea platii unei comenzi: o vede proprietarul sau ADMIN; pentru oricine altcineva comanda "nu exista". */
export class GetOrderPayment implements GetOrderPaymentUseCase {
  constructor(
    private readonly orders: PayableOrders,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(principal: Principal, orderId: string): Promise<Payment> {
    const order = await this.orders.find(orderId);
    if (!order || (principal.role !== 'ADMIN' && order.customerId !== principal.userId)) {
      throw new NotFoundError('Comanda', orderId);
    }
    const payment = await this.payments.findByOrderId(orderId);
    if (!payment) throw new NotFoundError('Plata comenzii', orderId);
    return payment;
  }
}
