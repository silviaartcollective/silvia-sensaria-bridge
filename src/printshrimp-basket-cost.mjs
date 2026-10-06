function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function printShrimpQuotedBasketTotal(checks = []) {
  const rows = Array.isArray(checks) ? checks : [];
  let productSubtotal = 0;
  let totalQuantity = 0;

  for (const item of rows) {
    const price = Number(item?.livePrice);
    const quantity = Math.max(1, Number(item?.quantity || 1));
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('PrintShrimp basket item is missing a valid live price');
    }
    productSubtotal += price * quantity;
    totalQuantity += quantity;
  }

  const shipping = rows.length ? Number(rows[0]?.liveShipping) : 0;
  if (!Number.isFinite(shipping) || shipping < 0) {
    throw new Error('PrintShrimp first basket item is missing a valid shipping price');
  }

  return {
    lineCount: rows.length,
    totalQuantity,
    shippingChargeCount: rows.length ? 1 : 0,
    quotedProductSubtotal: roundMoney(productSubtotal),
    quotedShipping: roundMoney(shipping),
    quotedOrderTotalBeforeAnyPublishedBulkDiscount: roundMoney(productSubtotal + shipping),
    shippingScope: 'order-once-first-item'
  };
}

export function printShrimpCandidateCostBreakdown(record) {
  if (!record || record.provider !== 'PrintShrimp') return null;

  const product = Number(record.productCost);
  const shipping = Number(record.shippingCost);
  const quotedTotalUsd = Number(record.totalUsd);
  const sourceTotal = product + shipping;

  if (
    !Number.isFinite(product) || product < 0 ||
    !Number.isFinite(shipping) || shipping < 0 ||
    !Number.isFinite(quotedTotalUsd) || quotedTotalUsd < 0 ||
    !Number.isFinite(sourceTotal) || sourceTotal <= 0
  ) return null;

  const usdPerSourceUnit = quotedTotalUsd / sourceTotal;
  const contingencyRate = Number(record.contingencyRate);

  return {
    quotedProductUsd: roundMoney(product * usdPerSourceUnit),
    quotedShippingUsd: roundMoney(shipping * usdPerSourceUnit),
    contingencyRate: Number.isFinite(contingencyRate) && contingencyRate >= 0 ? contingencyRate : 0,
    shippingScope: 'order-once-first-item',
    sourceCurrency: String(record.currency || '')
  };
}

export function printShrimpModeledBasketCost(items = []) {
  const rows = Array.isArray(items) ? items : [];
  let total = 0;
  let shippingApplied = false;

  for (const item of rows) {
    const breakdown = item?.breakdown;
    const productUsd = Number(breakdown?.quotedProductUsd);
    const shippingUsd = Number(breakdown?.quotedShippingUsd);
    const contingencyRate = Number(breakdown?.contingencyRate ?? 0);
    const quantity = Math.max(1, Number(item?.quantity || 1));

    if (
      breakdown?.shippingScope !== 'order-once-first-item' ||
      !Number.isFinite(productUsd) || productUsd < 0 ||
      !Number.isFinite(shippingUsd) || shippingUsd < 0 ||
      !Number.isFinite(contingencyRate) || contingencyRate < 0
    ) return null;

    total += productUsd * quantity * (1 + contingencyRate);
    if (!shippingApplied) {
      total += shippingUsd * (1 + contingencyRate);
      shippingApplied = true;
    }
  }

  return rows.length ? roundMoney(total) : 0;
}
