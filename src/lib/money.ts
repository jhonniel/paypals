import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function d(value: Decimal.Value): Decimal {
  return new Decimal(value || 0);
}

export function moneyNumber(value: Decimal.Value): number {
  return d(value).toDecimalPlaces(2).toNumber();
}

export function moneyString(value: Decimal.Value): string {
  return d(value).toDecimalPlaces(2).toFixed(2);
}

export type LineInput = {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  totalPrice?: Decimal.Value;
};

export function lineTotal(quantity: Decimal.Value, unitPrice: Decimal.Value): number {
  return moneyNumber(d(quantity).mul(d(unitPrice)));
}

export type TotalsInput = {
  items: LineInput[];
  tax?: Decimal.Value;
  discount?: Decimal.Value;
  serviceCharge?: Decimal.Value;
  tip?: Decimal.Value;
};

export type TotalsResult = {
  itemsSubtotal: number;
  tax: number;
  discount: number;
  serviceCharge: number;
  tip: number;
  total: number;
  /** Absolute difference between computed total and optional declared total */
  balance: number;
};

export function computeReceiptTotals(input: TotalsInput, declaredTotal?: Decimal.Value): TotalsResult {
  const itemsSubtotal = input.items.reduce((sum, item) => {
    const line =
      item.totalPrice !== undefined && item.totalPrice !== null && item.totalPrice !== ""
        ? d(item.totalPrice)
        : d(item.quantity).mul(d(item.unitPrice));
    return sum.plus(line);
  }, d(0));

  const tax = d(input.tax ?? 0);
  const discount = d(input.discount ?? 0);
  const serviceCharge = d(input.serviceCharge ?? 0);
  const tip = d(input.tip ?? 0);

  const total = itemsSubtotal.plus(tax).plus(serviceCharge).plus(tip).minus(discount);
  const balance =
    declaredTotal === undefined || declaredTotal === null || declaredTotal === ""
      ? d(0)
      : d(declaredTotal).minus(total).abs();

  return {
    itemsSubtotal: moneyNumber(itemsSubtotal),
    tax: moneyNumber(tax),
    discount: moneyNumber(discount),
    serviceCharge: moneyNumber(serviceCharge),
    tip: moneyNumber(tip),
    total: moneyNumber(total),
    balance: moneyNumber(balance),
  };
}

export function formatPHP(value: Decimal.Value, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(moneyNumber(value));
}
