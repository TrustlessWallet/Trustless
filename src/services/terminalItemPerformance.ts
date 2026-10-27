import { SQLiteDatabase } from 'expo-sqlite';
import { getTerminalDatabase, serializeTerminalDatabase, transactTerminalDatabase } from './terminalDatabase';
import { terminalScope, TerminalRange } from './terminalSales';
import { isTerminalItemName } from './terminal';
import { formatTerminalComparisonAmount } from './terminalSalesComparison';

export type ItemUnit = 'USD' | 'EUR' | 'CHF' | 'sats';
export type ItemSort = 'quantity' | 'gross';
export type TerminalItemPerformanceRow = { itemId: string; name: string; unit: ItemUnit; quantity: bigint; gross: bigint };
export type TerminalItemPerformance = { items: TerminalItemPerformanceRow[]; hasMore: boolean; paidWithoutItems: number };
type ItemRow = { seq?: number; item_id: string; name: string; unit: ItemUnit; quantity: string; gross_hi: string; gross_lo: string };
const LIMB = 1_000_000_000n;
const MAX = Number.MAX_SAFE_INTEGER;
const units: ItemUnit[] = ['USD', 'EUR', 'CHF', 'sats'];
export const formatTerminalItemGross = (value: bigint, unit: ItemUnit) => formatTerminalComparisonAmount(value, unit);

function reportScope(walletId: string, network: string, range: TerminalRange) {
  const scope = terminalScope(walletId, network);
  if (range !== null && (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.end <= range.start)) throw new Error('Invalid Terminal item performance range.');
  return { args: [scope.walletId, scope.network, ...(range ? [range.start, range.end] : [])],
    paid: `SELECT id,activity_at,payload FROM terminal_sales WHERE wallet_id=? AND network=? AND status='received'
      ${range ? 'AND activity_at>=? AND activity_at<?' : ''}` };
}

async function validateReport(db: SQLiteDatabase, paid: string, args: (string | number)[]): Promise<number> {
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
    return stats?.missing ?? 0;

}

/** Exact original totals; normalize low-limb carry before ranking gross amounts. */
function aggregation(paid: string): string {
  return `WITH paid AS (${paid}), lines AS (
    SELECT p.id,p.activity_at,json_extract(l.value,'$.itemId') AS item_id,json_extract(l.value,'$.name') AS name,
      CASE WHEN json_extract(p.payload,'$.request.basket.unit')='BTC' THEN 'sats' ELSE json_extract(p.payload,'$.request.basket.unit') END AS unit,
      json_extract(l.value,'$.quantity') AS quantity,json_extract(l.value,'$.total') AS total
    FROM paid p JOIN json_each(p.payload,'$.request.basket.lines') l
  ), named AS (
    SELECT *,ROW_NUMBER() OVER (PARTITION BY item_id,unit ORDER BY activity_at DESC,id DESC) AS latest FROM lines
  ), grouped AS (
    SELECT item_id,unit,MAX(CASE WHEN latest=1 THEN name END) AS name,SUM(quantity) AS quantity,
      SUM(CAST(total/1000000000 AS INTEGER)) AS hi,SUM(total%1000000000) AS lo FROM named GROUP BY item_id,unit
  ), totals AS (
    SELECT item_id,unit,name,quantity,hi+CAST(lo/1000000000 AS INTEGER) AS gross_hi,lo%1000000000 AS gross_lo FROM grouped
  )`;
}
const columns = 'item_id,unit,name,CAST(quantity AS TEXT) AS quantity,CAST(gross_hi AS TEXT) AS gross_hi,CAST(gross_lo AS TEXT) AS gross_lo';
const quantityOrder = 'totals.quantity DESC,totals.item_id COLLATE BINARY,totals.unit COLLATE BINARY';
const grossOrder = 'totals.gross_hi DESC,totals.gross_lo DESC,totals.item_id COLLATE BINARY,totals.unit COLLATE BINARY';
function decodeItem(row: ItemRow): TerminalItemPerformanceRow {
  if (!isTerminalItemName(row.name) || typeof row.item_id !== 'string' || !row.item_id || !units.includes(row.unit)) throw new Error('Saved Terminal item details are invalid.');
  const quantity = BigInt(row.quantity), hi = BigInt(row.gross_hi), lo = BigInt(row.gross_lo);
  if (quantity <= 0n || hi < 0n || lo < 0n || lo >= LIMB || hi * LIMB + lo <= 0n) throw new Error('Saved Terminal item totals are invalid.');
  return { itemId: row.item_id, name: row.name, unit: row.unit, quantity, gross: hi * LIMB + lo };
}

/** Compact compatibility query; full reports use immutable snapshots below. */
export async function getTerminalItemPerformance(walletId: string, network: string, range: TerminalRange): Promise<TerminalItemPerformance> {
  const { paid, args } = reportScope(walletId, network, range);
  return serializeTerminalDatabase(async db => {
    const paidWithoutItems = await validateReport(db, paid, args);
    // Do not order by the text-cast output aliases.
    const rows = await db.getAllAsync<ItemRow>(`${aggregation(paid)} SELECT ${columns} FROM totals ORDER BY totals.quantity DESC,item_id COLLATE BINARY,unit COLLATE BINARY LIMIT 6`, args);
    return { items: rows.slice(0, 5).map(decodeItem), hasMore: rows.length > 5, paidWithoutItems };
  });
}

export async function createTerminalItemPerformanceSnapshot(walletId: string, network: string, range: TerminalRange, options: { sort: ItemSort; unit: ItemUnit | null }): Promise<{ token: string; totalCount: number; paidWithoutItems: number }> {
  const { paid, args } = reportScope(walletId, network, range);
  if (!options || !['quantity', 'gross'].includes(options.sort) || (options.unit !== null && !units.includes(options.unit)) || (options.sort === 'gross' && options.unit === null)) throw new Error('Choose a currency to sort by gross.');
  const sort = options.sort, unit = options.unit;
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return transactTerminalDatabase(async db => {
    const paidWithoutItems = await validateReport(db, paid, args);
    const result = await db.runAsync(`${aggregation(paid)}
      INSERT INTO terminal_item_report_rows(snapshot_id,item_id,unit,name,quantity,gross_hi,gross_lo)
      SELECT ?,${columns} FROM totals ${unit === null ? '' : 'WHERE unit=?'} ORDER BY ${sort === 'gross' ? grossOrder : quantityOrder}`,
      [...args, token, ...(unit === null ? [] : [unit])]);
    return { token, totalCount: result.changes, paidWithoutItems };
  });
}

export async function readTerminalItemPerformancePage(token: string, afterSeq = 0, limit = 20): Promise<{ items: TerminalItemPerformanceRow[]; nextSeq: number | null }> {
  if (!token || !Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid item report page.');
  const db = await getTerminalDatabase();
  const rows = await db.getAllAsync<ItemRow & { seq: number }>('SELECT seq,item_id,unit,name,quantity,gross_hi,gross_lo FROM terminal_item_report_rows WHERE snapshot_id=? AND seq>? ORDER BY seq LIMIT ?', [token, afterSeq, limit + 1]);
  const page = rows.slice(0, limit);
  return { items: page.map(decodeItem), nextSeq: rows.length > limit ? page[page.length - 1].seq : null };
}

export function removeTerminalItemPerformanceSnapshot(token: string): Promise<void> {
  if (!token) return Promise.reject(new Error('Invalid item report snapshot.'));
  return serializeTerminalDatabase(async db => { await db.runAsync('DELETE FROM terminal_item_report_rows WHERE snapshot_id=?', [token]); });
}
