export class OrderService {
  /**
   * Create a new order with the given items.
   */
  createOrder(items: string[]): number {
    // compute total
    let total = 0;
    for (const item of items) {
      total += item.length;
    }
    return total;
  }
}
