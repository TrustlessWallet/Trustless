import AsyncStorage from '@react-native-async-storage/async-storage';
import { terminalNetwork, TerminalNetwork } from './terminal';
import { ItemSort, ItemUnit } from './terminalItemPerformance';
import { CustomSalesDateRange, localSalesDateKey, parseSalesDate, SalesPeriod } from './terminalSalesPeriod';

export const TERMINAL_REPORT_PRESETS_KEY = '@terminalReportPresets:v1';
export type TerminalReportPreset = Readonly<{
  period: SalesPeriod;
  customRange?: CustomSalesDateRange;
  tab: 'overview' | 'items';
  unit: ItemUnit | null;
  sort: ItemSort;
}>;
export type TerminalReportPresetConfig = TerminalReportPreset;
type StoredPreset = Readonly<{ key: string; config: TerminalReportPreset }>;

const MAX_PRESETS = 10;
const MAX_RAW_LENGTH = 32_768;
const periods: SalesPeriod[] = ['today', 'week', 'month', 'all', 'custom'];
const units: ItemUnit[] = ['USD', 'EUR', 'CHF', 'sats'];
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
};

function scope(walletId: string, network: string) {
  if (typeof walletId !== 'string' || !walletId || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
}
const keyFor = (walletId: string, network: TerminalNetwork) => `${TERMINAL_REPORT_PRESETS_KEY}:${network}:${walletId}`;

function canonicalConfig(value: unknown, checkFuture: boolean): TerminalReportPreset {
  if (!value || typeof value !== 'object') throw new Error('Invalid report preset.');
  const input = value as Record<string, unknown>;
  if (!periods.includes(input.period as SalesPeriod) || !['overview', 'items'].includes(input.tab as string) ||
    (input.unit !== null && !units.includes(input.unit as ItemUnit)) || !['quantity', 'gross'].includes(input.sort as string)) {
    throw new Error('Invalid report preset.');
  }
  const period = input.period as SalesPeriod;
  let customRange: CustomSalesDateRange | undefined;
  if (period === 'custom') {
    const range = input.customRange as Record<string, unknown> | undefined;
    if (!range || typeof range.startDate !== 'string' || typeof range.endDate !== 'string') throw new Error('Invalid report preset.');
    const start = parseSalesDate(range.startDate), end = parseSalesDate(range.endDate);
    if (start.getTime() > end.getTime() || (checkFuture && range.endDate > localSalesDateKey(new Date()))) throw new Error('Invalid report preset.');
    customRange = { startDate: range.startDate, endDate: range.endDate };
  }
  const tab = input.tab as 'overview' | 'items';
  const unit = tab === 'overview' ? null : input.unit as ItemUnit | null;
  const sort = tab === 'overview' ? 'quantity' : input.sort as ItemSort;
  if (tab === 'items' && sort === 'gross' && unit === null) throw new Error('Invalid report preset.');
  return { period, ...(customRange ? { customRange } : {}), tab, unit, sort };
}

export function reportPresetKey(config: TerminalReportPreset): string {
  return JSON.stringify(canonicalConfig(config, false));
}

async function read(walletId: string, network: TerminalNetwork): Promise<StoredPreset[]> {
  const raw = await AsyncStorage.getItem(keyFor(walletId, network));
  if (raw === null) return [];
  if (raw.length > MAX_RAW_LENGTH) throw new Error('Saved report presets are invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved report presets are unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 || (parsed as any).walletId !== walletId ||
    (parsed as any).network !== network || !Array.isArray((parsed as any).presets)) throw new Error('Saved report presets are invalid.');
  const stored = (parsed as { presets: unknown[] }).presets;
  if (stored.length > MAX_PRESETS) throw new Error('Saved report presets are invalid.');
  const presets = stored.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof (entry as any).key !== 'string') throw new Error('Saved report presets are invalid.');
    const config = canonicalConfig((entry as any).config, false);
    const key = JSON.stringify(config);
    if ((entry as any).key !== key || JSON.stringify((entry as any).config) !== key) throw new Error('Saved report presets are invalid.');
    return { key, config };
  });
  if (new Set(presets.map(preset => preset.key)).size !== presets.length) throw new Error('Saved report presets are invalid.');
  return presets;
}

export async function listTerminalReportPresets(walletId: string, network: string): Promise<TerminalReportPreset[]> {
  const identity = scope(walletId, network);
  const presets = await serial(() => read(identity.walletId, identity.network));
  return presets.map(preset => preset.config);
}

export function saveTerminalReportPreset(walletId: string, network: string, config: TerminalReportPreset, isCurrent: () => boolean): Promise<TerminalReportPreset[]> {
  const identity = scope(walletId, network);
  let frozen: TerminalReportPreset;
  try { frozen = canonicalConfig(config, true); } catch (error) { return Promise.reject(error); }
  const preset: StoredPreset = { key: JSON.stringify(frozen), config: frozen };
  return serial(async () => {
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    const presets = await read(identity.walletId, identity.network);
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    if (presets.some(entry => entry.key === preset.key)) return presets.map(entry => entry.config);
    if (presets.length >= MAX_PRESETS) throw new Error('Report preset limit reached.');
    const next = [...presets, preset];
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    await AsyncStorage.setItem(keyFor(identity.walletId, identity.network), JSON.stringify({ version: 1, walletId: identity.walletId, network: identity.network, presets: next }));
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    return next.map(entry => entry.config);
  });
}

export function removeTerminalReportPreset(walletId: string, network: string, config: TerminalReportPreset, isCurrent: () => boolean): Promise<TerminalReportPreset[]> {
  const identity = scope(walletId, network);
  let presetKey: string;
  try { presetKey = reportPresetKey(config); } catch (error) { return Promise.reject(error); }
  return serial(async () => {
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    const presets = await read(identity.walletId, identity.network);
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    const next = presets.filter(entry => entry.key !== presetKey);
    if (next.length === presets.length) return presets.map(entry => entry.config);
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    await AsyncStorage.setItem(keyFor(identity.walletId, identity.network), JSON.stringify({ version: 1, walletId: identity.walletId, network: identity.network, presets: next }));
    if (!isCurrent()) throw new Error('Current Terminal report scope is required.');
    return next.map(entry => entry.config);
  });
}
