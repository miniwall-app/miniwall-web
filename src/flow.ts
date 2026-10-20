/**
 * Screens linked into a flow and the answers collected along it. Pure helpers; render.ts drives them.
 */
import type { Answers, PaywallJson } from './types';

/** "Go to screen" / "Back to previous screen" buttons, stored as workflow action IDs. */
const SCREEN_PREFIX = 'screen:';
export const BACK = 'screen:back';

export type ScreenLink = { kind: 'back' } | { kind: 'goto'; id: string };

/** What a workflow action ID asks for: a screen change, or null for a "Run your code" ID. */
export function screenLink(actionId: string): ScreenLink | null {
  if (actionId === BACK) return { kind: 'back' };
  if (actionId.startsWith(SCREEN_PREFIX) && actionId.length > SCREEN_PREFIX.length) return { kind: 'goto', id: actionId.slice(SCREEN_PREFIX.length) };
  return null;
}

export type FieldKind = 'single' | 'multiple' | 'text';

const KIND_BY_TYPE: Record<string, FieldKind> = {
  input_single_choice: 'single',
  input_multiple_choice: 'multiple',
  input_text: 'text',
};

/** Every node in the JSON, however it is nested (stacks, wrappers, tabs, overrides...). */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}

/** The questions on a screen: field ID → how its answer is kept. */
export function questionFields(paywall: PaywallJson): Map<string, FieldKind> {
  const fields = new Map<string, FieldKind>();
  walk(paywall.components_config, (node) => {
    const kind = KIND_BY_TYPE[node.type as string];
    if (kind && typeof node.field_id === 'string' && node.field_id) fields.set(node.field_id, kind);
  });
  return fields;
}

/** Screens this one links to, to load them before the visitor taps. */
export function linkedScreens(paywall: PaywallJson): string[] {
  const ids = new Set<string>();
  walk(paywall.components_config, (node) => {
    const link = screenLink(String((node.triggers as { on_press?: unknown } | undefined)?.on_press ?? ''));
    if (link?.kind === 'goto') ids.add(link.id);
  });
  return [...ids];
}

/**
 * The answers after one change. The renderer reports the tapped option (or
 * the typed text): a single choice replaces, a multiple choice toggles, and
 * an emptied text field drops its answer.
 */
export function applyAnswer(answers: Answers, kind: FieldKind | undefined, fieldId: string, value: string): Answers {
  const next = { ...answers };
  if (kind === 'multiple') {
    const current = Array.isArray(next[fieldId]) ? (next[fieldId] as string[]) : [];
    const toggled = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    if (toggled.length) next[fieldId] = toggled;
    else delete next[fieldId];
    return next;
  }
  if (value === '') delete next[fieldId];
  else next[fieldId] = value;
  return next;
}

/** What the renderer needs to show earlier answers again when the visitor comes back. */
export function initialSelections(answers: Answers): Record<string, string[]> {
  return Object.fromEntries(Object.entries(answers).map(([field, value]) => [field, Array.isArray(value) ? value : [value]]));
}

/**
 * The chosen options on one screen, for analytics. Typed text is never
 * included: it can be an email or a name, so it stays with the site.
 */
export function chosenOptions(answers: Answers, fields: Map<string, FieldKind>): { fieldId: string; optionId: string }[] {
  const chosen: { fieldId: string; optionId: string }[] = [];
  for (const [fieldId, kind] of fields) {
    if (kind === 'text') continue;
    const value = answers[fieldId];
    for (const optionId of Array.isArray(value) ? value : value ? [value] : []) chosen.push({ fieldId, optionId });
  }
  return chosen;
}
