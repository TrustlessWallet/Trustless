import { SQLiteDatabase } from 'expo-sqlite';
import { v4 as uuidv4 } from 'uuid';
import { terminalNetwork, TerminalNetwork } from './terminal';
import { transactTerminalDatabase } from './terminalDatabase';
import { clearTerminalPreferenceInDatabase, readTerminalPreferenceInDatabase, writeTerminalPreferenceInDatabase } from './terminalPreferences';
import { normalizeTerminalReceiptBranding, TerminalReceiptBranding } from './terminalReceiptBranding';

export const TERMINAL_RECEIPT_TEMPLATES_KEY = '@terminalReceiptTemplates:v1';
export type TerminalReceiptTemplate = Readonly<{ id: string; name: string; branding: TerminalReceiptBranding }>;
const MAX_TEMPLATES = 5;
const MAX_RAW_LENGTH = 1_400_000;
const unsafeName = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\uFEFF]/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
let queue: Promise<unknown> = Promise.resolve();
const deletedScopes = new Set<string>();
const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
};
function scope(walletId: string, network: string) {
  if (typeof walletId !== 'string' || !walletId || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
}
const keyFor = (walletId: string, network: TerminalNetwork) => `${TERMINAL_RECEIPT_TEMPLATES_KEY}:${network}:${walletId}`;
function assertNotDeleted(walletId: string, network: TerminalNetwork): void {
  if (deletedScopes.has(keyFor(walletId, network))) throw new Error('Terminal receipt wallet was removed.');
}
function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid receipt template name.');
  const name = value.trim();
  if (!name || name.length > 40 || unsafeName.test(name)) throw new Error('Invalid receipt template name.');
  if (name.normalize('NFKC').toLowerCase() === 'standard') throw new Error('Standard is reserved for the default receipt.');
  return name;
}
const foldedName = (name: string) => name.normalize('NFKC').toLowerCase();
function validateTemplate(value: unknown): TerminalReceiptTemplate {
  if (!value || typeof value !== 'object') throw new Error('Saved receipt templates are invalid.');
  const template = value as Record<string, unknown>;
  if (typeof template.id !== 'string' || !uuidPattern.test(template.id)) throw new Error('Saved receipt templates are invalid.');
  const result = { id: template.id, name: normalizeName(template.name), branding: normalizeTerminalReceiptBranding(template.branding) };
  if (JSON.stringify(value) !== JSON.stringify(result)) throw new Error('Saved receipt templates are invalid.');
  return result;
}
export function normalizeTerminalReceiptTemplates(value: unknown): TerminalReceiptTemplate[] {
  if (!Array.isArray(value) || value.length > MAX_TEMPLATES) throw new Error('Saved receipt templates are invalid.');
  const templates = value.map(validateTemplate);
  if (new Set(templates.map(item => item.id)).size !== templates.length ||
    new Set(templates.map(item => foldedName(item.name))).size !== templates.length) throw new Error('Saved receipt templates are invalid.');
  return templates;
}
function parse(raw: string | null, walletId: string, network: TerminalNetwork): TerminalReceiptTemplate[] {
  if (raw === null) return [];
  if (raw.length > MAX_RAW_LENGTH) throw new Error('Saved receipt templates are too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved receipt templates are unreadable.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Saved receipt templates are invalid.');
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1 || envelope.walletId !== walletId || envelope.network !== network) throw new Error('Saved receipt templates are invalid.');
  const templates = normalizeTerminalReceiptTemplates(envelope.templates);
  if (JSON.stringify(parsed) !== JSON.stringify({ version: 1, walletId, network, templates })) throw new Error('Saved receipt templates are invalid.');
  return templates;
}

export function readTerminalReceiptTemplatesInDatabase(db: SQLiteDatabase, walletId: string, network: string): Promise<TerminalReceiptTemplate[]> {
  const identity = scope(walletId, network);
  return readTerminalPreferenceInDatabase(db, identity.walletId, identity.network, 'templates',
    keyFor(identity.walletId, identity.network), raw => parse(raw, identity.walletId, identity.network));
}

export async function writeTerminalReceiptTemplatesInDatabase(db: SQLiteDatabase, walletId: string, network: string,
  templates: readonly TerminalReceiptTemplate[]): Promise<void> {
  const identity = scope(walletId, network);
  assertNotDeleted(identity.walletId, identity.network);
  const validated = normalizeTerminalReceiptTemplates(templates);
  await writeTerminalPreferenceInDatabase(db, identity.walletId, identity.network, 'templates',
    encode(identity.walletId, identity.network, validated));
}
function encode(walletId: string, network: TerminalNetwork, templates: TerminalReceiptTemplate[]): string {
  const raw = JSON.stringify({ version: 1, walletId, network, templates });
  if (raw.length > MAX_RAW_LENGTH) throw new Error('Receipt template library is too large.');
  return raw;
}
function current(walletId: string, network: TerminalNetwork, isCurrent: () => boolean): void {
  assertNotDeleted(walletId, network);
  if (!isCurrent()) throw new Error('Current Terminal receipt scope is required.');
}

export function loadTerminalReceiptTemplates(walletId: string, network: string): Promise<TerminalReceiptTemplate[]> {
  const identity = scope(walletId, network);
  return serial(() => transactTerminalDatabase(db => readTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network)));
}
export function createTerminalReceiptTemplate(walletId: string, network: string, name: string,
  branding: TerminalReceiptBranding, isCurrent: () => boolean): Promise<TerminalReceiptTemplate[]> {
  const identity = scope(walletId, network);
  let frozenName: string, frozenBranding: TerminalReceiptBranding;
  try { frozenName = normalizeName(name); frozenBranding = normalizeTerminalReceiptBranding(branding); }
  catch (error) { return Promise.reject(error); }
  return serial(() => transactTerminalDatabase(async db => {
    current(identity.walletId, identity.network, isCurrent);
    const templates = await readTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network);
    current(identity.walletId, identity.network, isCurrent);
    if (templates.length >= MAX_TEMPLATES) throw new Error('Receipt template limit reached.');
    if (templates.some(item => foldedName(item.name) === foldedName(frozenName))) throw new Error('Receipt template name already exists.');
    const id = uuidv4();
    if (!uuidPattern.test(id) || templates.some(item => item.id === id)) throw new Error('Couldn’t create a unique receipt template.');
    const next = [...templates, { id, name: frozenName, branding: frozenBranding }];
    current(identity.walletId, identity.network, isCurrent);
    await writeTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network, next);
    current(identity.walletId, identity.network, isCurrent);
    return next;
  }));
}
export function replaceTerminalReceiptTemplate(walletId: string, network: string, id: string,
  branding: TerminalReceiptBranding, isCurrent: () => boolean): Promise<TerminalReceiptTemplate[]> {
  const identity = scope(walletId, network);
  if (typeof id !== 'string' || !uuidPattern.test(id)) return Promise.reject(new Error('Invalid receipt template ID.'));
  let frozen: TerminalReceiptBranding;
  try { frozen = normalizeTerminalReceiptBranding(branding); } catch (error) { return Promise.reject(error); }
  return serial(() => transactTerminalDatabase(async db => {
    current(identity.walletId, identity.network, isCurrent);
    const templates = await readTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network);
    current(identity.walletId, identity.network, isCurrent);
    if (!templates.some(item => item.id === id)) throw new Error('Receipt template not found.');
    const next = templates.map(item => item.id === id ? { id, name: item.name, branding: frozen } : item);
    current(identity.walletId, identity.network, isCurrent);
    await writeTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network, next);
    current(identity.walletId, identity.network, isCurrent);
    return next;
  }));
}
export function removeTerminalReceiptTemplate(walletId: string, network: string, id: string,
  isCurrent: () => boolean): Promise<TerminalReceiptTemplate[]> {
  const identity = scope(walletId, network);
  if (typeof id !== 'string' || !uuidPattern.test(id)) return Promise.reject(new Error('Invalid receipt template ID.'));
  return serial(() => transactTerminalDatabase(async db => {
    current(identity.walletId, identity.network, isCurrent);
    const templates = await readTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network);
    current(identity.walletId, identity.network, isCurrent);
    const next = templates.filter(item => item.id !== id);
    if (next.length === templates.length) return next;
    current(identity.walletId, identity.network, isCurrent);
    await writeTerminalReceiptTemplatesInDatabase(db, identity.walletId, identity.network, next);
    current(identity.walletId, identity.network, isCurrent);
    return next;
  }));
}

export function clearTerminalReceiptTemplates(walletId: string, network: string): Promise<void> {
  const identity = scope(walletId, network);
  const key = keyFor(identity.walletId, identity.network);
  deletedScopes.add(key);
  return serial(() => transactTerminalDatabase(db => clearTerminalPreferenceInDatabase(db,
    identity.walletId, identity.network, 'templates', key))).catch(error => {
    deletedScopes.delete(key);
    throw error;
  });
}
