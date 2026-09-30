import { PROGRAM_SUGGESTION_MAX_LENGTH, type ProgramKind, type ProgramRef } from '../../profile/about';
import { PROGRAM_ALIASES } from './programAliases';

export { PROGRAM_SUGGESTION_MAX_LENGTH, type ProgramKind };

/**
 * The major/minor picker's pure logic (`ProgramPickerSheet.tsx`): search
 * with aliases, which rows are selected or disabled, and what a pick does to
 * the major and minor. Kept free of React so it is tested directly.
 *
 * Program labels are the owner's data from `public.programs`, shown
 * verbatim; nothing here types a label (the aliases live in
 * `programAliases.ts`, which is data too).
 */

/**
 * How a label, an alias or a search is compared: lowercase, accents dropped,
 * every run of punctuation or spaces read as one space, trimmed. So
 * `Pre-Med`, `pre med` and ` pre  med ` are the same text.
 */
export function normalizeProgramText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The normalised text with its spaces removed, so `premed` finds `pre-med` and `poli sci` finds `polisci`. */
function compact(text: string): string {
  return normalizeProgramText(text).replace(/ /g, '');
}

export type ProgramAliases = Readonly<Record<string, readonly string[]>>;

/** Aliases re-keyed by normalised label, so a lookup ignores case and punctuation in the catalog's label. */
function aliasIndex(aliases: ProgramAliases): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [label, list] of Object.entries(aliases)) {
    const key = normalizeProgramText(label);
    index.set(key, [...(index.get(key) ?? []), ...list]);
  }
  return index;
}

const DEFAULT_INDEX = aliasIndex(PROGRAM_ALIASES);

/** Whether a search leaves anything to compare (punctuation and spaces alone do not). */
export function isSearching(query: string): boolean {
  return compact(query).length > 0;
}

/**
 * Whether a program is found by a search: case-insensitive, anywhere inside
 * the label or one of its aliases, ignoring punctuation and spaces. An empty
 * search finds everything.
 */
export function programFound(label: string, query: string, aliases: ProgramAliases = PROGRAM_ALIASES): boolean {
  const q = compact(query);
  if (!q) return true;
  if (compact(label).includes(q)) return true;
  const index = aliases === PROGRAM_ALIASES ? DEFAULT_INDEX : aliasIndex(aliases);
  return (index.get(normalizeProgramText(label)) ?? []).some((alias) => compact(alias).includes(q));
}

/** The programs a search finds, in the server's order (`sort_order`, then label). */
export function filterPrograms<T extends { label: string }>(programs: T[], query: string, aliases?: ProgramAliases): T[] {
  if (!isSearching(query)) return programs;
  return programs.filter((program) => programFound(program.label, query, aliases));
}

/** One row of the list: the program, whether it is the current pick, and whether it can be picked. */
export interface ProgramOption {
  program: ProgramRef;
  selected: boolean;
  /** The minor picker's row for the chosen major: shown, but not pickable. */
  disabled: boolean;
}

/**
 * The rows to show for a search. When picking a minor, the chosen major's
 * row stays in the list (so nobody wonders where it went) but is disabled:
 * the minor has to differ from the major (`set_my_about`).
 */
export function programOptions(
  programs: ProgramRef[],
  query: string,
  { selectedId, majorId = null }: { selectedId: string | null; majorId?: string | null },
  aliases?: ProgramAliases
): ProgramOption[] {
  return filterPrograms(programs, query, aliases).map((program) => ({
    program,
    selected: program.id === selectedId,
    disabled: majorId !== null && program.id === majorId,
  }));
}

/** The clear row (`no major`, `no minor`) shows at the top when offered, and not while searching. */
export function showClearRow(clearLabel: string | undefined, query: string): boolean {
  return !!clearLabel && !isSearching(query);
}

/**
 * The major and minor after a pick. Clearing the major clears the minor (a
 * minor needs a major); a major equal to the current minor takes the minor's
 * place and clears it (they must differ). A minor equal to the major is
 * refused (the row is disabled; this is the guard behind it).
 */
export function applyProgramPick(
  kind: ProgramKind,
  program: ProgramRef | null,
  current: { major: ProgramRef | null; minor: ProgramRef | null }
): { major: ProgramRef | null; minor: ProgramRef | null } {
  if (kind === 'major') {
    const keepMinor = program && current.minor && current.minor.id !== program.id ? current.minor : null;
    return { major: program, minor: keepMinor };
  }
  if (!current.major) return { major: null, minor: null };
  if (program && program.id === current.major.id) return current;
  return { major: current.major, minor: program };
}

/** A listed program whose label is the same text as a suggestion (ignoring case and punctuation), if any. */
export function findListedProgram<T extends { label: string }>(programs: T[], label: string): T | null {
  const key = compact(label);
  if (!key) return null;
  return programs.find((program) => compact(program.label) === key) ?? null;
}

/** A search, cut to fit, as the suggestion form's starting text. */
export function suggestionFromQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, PROGRAM_SUGGESTION_MAX_LENGTH);
}

/** The result count under the search field, e.g. `3 results`. */
export function resultCountText(count: number): string {
  if (count === 0) return 'no results';
  return count === 1 ? '1 result' : `${count} results`;
}
