import { serializeTerminalDatabase } from './terminalDatabase';
import { terminalScope, TerminalRange } from './terminalSales';
import { isTerminalItemName } from './terminal';
import { formatTerminalComparisonAmount } from './terminalSalesComparison';

type ItemUnit = 'USD' | 'EUR' | 'CHF' | 'sats';
export type TerminalItemPerformanceRow = { itemId: string; name: string; unit: ItemUnit; quantity: bigint; gross: bigint };
export type TerminalItemPerformance = { items: TerminalItemPerformanceRow[]; hasMore: boolean; paidWithoutItems: number };
const LIMB = 1_000_000_000n;
const MAX = Number.MAX_SAFE_INTEGER;

export const formatTerminalItemGross = (value: bigint, unit: ItemUnit) => formatTerminalComparisonAmount(value, unit);

/** Report original paid basket snapshots, never mutable catalog prices or names. */
export function getTerminalItemPerformance(walletId: string, network: string, range: TerminalRange): Promise<TerminalItemPerformance> {
  const scope = terminalScope(walletId, network);
  if (range !== null && (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.end <= range.start)) {
    return Promise.reject(new Error('Invalid Terminal item performance range.'));
  }
  const args = [scope.walletId, scope.network, ...(range ? [range.start, range.end] : [])];
  const paid = `SELECT id,activity_at,payload FROM terminal_sales WHERE wallet_id=? AND network=? AND status='received'
    ${range ? 'AND activity_at>=? AND activity_at<?' : ''}`;
  return serializeTerminalDatabase(async db => {
    // Validate stored snapshots rather than silently presenting corrupt lines as zero sales.
    const stats = await db.getFirstAsync<{ missing: number; invalid: number }>(`WITH paid AS (${paid}),
      checked AS (
        SELECT p.id,json_type(p.payload,'$.request.basket') AS kind,
          CASE WHEN json_type(p.payload,'$.request.basket') IS NULL THEN 1 ELSE CASE WHEN
            json_type(p.payload,'$.request.basket')='object'
            AND json_type(p.payload,'$.request.basket.lines')='array'
            AND json_array_length(p.payload,'$.request.basket.lines') BETWEEN 1 AND 20
            AND json_extract(p.payload,'$.request.basket.unit')=COALESCE(json_extract(p.payload,'$.request.fiat.currency'),json_extract(p.payload,'$.request.inputUnit'),'sats')
            AND json_extract(p.payload,'$.request.basket.unit') IN ('USD','EUR','CHF','sats','BTC')
            AND json_type(p.payload,'$.request.basket.total')='integer'
            AND json_extract(p.payload,'$.request.basket.total')=COALESCE(json_extract(p.payload,'$.request.fiat.amountMinor'),json_extract(p.payload,'$.request.amountSats'))
            AND COUNT(l.key)=COUNT(DISTINCT json_extract(l.value,'$.itemId'))
            AND SUM(json_extract(l.value,'$.total'))=json_extract(p.payload,'$.request.basket.total')
            AND MIN(CASE WHEN json_type(l.value)='object'
              AND json_type(l.value,'$.itemId')='text' AND length(trim(json_extract(l.value,'$.itemId'))) BETWEEN 1 AND 128
              AND json_type(l.value,'$.name')='text' AND length(trim(json_extract(l.value,'$.name'))) BETWEEN 1 AND 60
              AND json_type(l.value,'$.quantity')='integer' AND json_extract(l.value,'$.quantity') BETWEEN 1 AND 99
              AND json_type(l.value,'$.unitPrice')='integer' AND json_extract(l.value,'$.unitPrice') BETWEEN 1 AND ${MAX}
              AND json_type(l.value,'$.total')='integer' AND json_extract(l.value,'$.total') BETWEEN 1 AND ${MAX}
              AND json_extract(l.value,'$.unitPrice')*json_extract(l.value,'$.quantity')=json_extract(l.value,'$.total')
              THEN 1 ELSE 0 END)=1
            THEN 1 ELSE 0 END END AS valid
        FROM paid p LEFT JOIN json_each(p.payload,'$.request.basket.lines') l GROUP BY p.id
      ) SELECT COALESCE(SUM(CASE WHEN kind IS NULL THEN 1 ELSE 0 END),0) AS missing,
        COALESCE(SUM(CASE WHEN valid IS NOT 1 THEN 1 ELSE 0 END),0) AS invalid FROM checked`, args);
    if (stats?.invalid) throw new Error('Saved Terminal item details are invalid.');
    const rows = await db.getAllAsync<{ item_id: string; name: string; unit: ItemUnit; quantity: string; hi: string; lo: string }>(`WITH paid AS (${paid}),
      lines AS (
        SELECT p.id,p.activity_at,json_extract(l.value,'$.itemId') AS item_id,json_extract(l.value,'$.name') AS name,
          CASE WHEN json_extract(p.payload,'$.request.basket.unit')='BTC' THEN 'sats' ELSE json_extract(p.payload,'$.request.basket.unit') END AS unit,
          json_extract(l.value,'$.quantity') AS quantity,json_extract(l.value,'$.total') AS total
        FROM paid p JOIN json_each(p.payload,'$.request.basket.lines') l
      ), named AS (
        SELECT *,ROW_NUMBER() OVER (PARTITION BY item_id,unit ORDER BY activity_at DESC,id DESC) AS latest FROM lines
      ) SELECT item_id,unit,MAX(CASE WHEN latest=1 THEN name END) AS name,CAST(SUM(quantity) AS TEXT) AS quantity,
        CAST(SUM(CAST(total/1000000000 AS INTEGER)) AS TEXT) AS hi,CAST(SUM(total%1000000000) AS TEXT) AS lo
      FROM named GROUP BY item_id,unit ORDER BY SUM(quantity) DESC,item_id COLLATE BINARY,unit COLLATE BINARY LIMIT 6`, args);
    const items = rows.slice(0, 5).map(row => {
      if (!isTerminalItemName(row.name)) throw new Error('Saved Terminal item name is invalid.');
      return { itemId: row.item_id, name: row.name, unit: row.unit, quantity: BigInt(row.quantity), gross: BigInt(row.hi) * LIMB + BigInt(row.lo) };
    });
    return { items, hasMore: rows.length > 5, paidWithoutItems: stats?.missing ?? 0 };
  });
}
