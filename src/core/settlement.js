// 現地通貨建ての支払い・受け取りを、その時点のレートで自動的に円換算する（手数料込み）
// 弾薬費・仲間の日給・戦闘報酬などに使う

import { CONFIG } from "../config.js";

// 支払うとき：手数料のぶん多く払う
export function paymentInYen(amountLocal, ccy, prices, config = CONFIG) {
  return amountLocal * rateOf(ccy, prices) * (1 + config.settlement.conversionFee);
}

// 受け取るとき：手数料のぶん少なく受け取る
export function receiptInYen(amountLocal, ccy, prices, config = CONFIG) {
  return amountLocal * rateOf(ccy, prices) * (1 - config.settlement.conversionFee);
}

function rateOf(ccy, prices) {
  if (ccy === "JPY") return 1;
  const r = prices[ccy];
  if (r == null) throw new Error(`${ccy} のレートがありません`);
  return r;
}
