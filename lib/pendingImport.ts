/**
 * Hands a parsed import file from Settings to the Add screen's review step.
 * The file picker has to open from Settings itself (browsers only open it from
 * a direct tap), so the result is parked here for the one screen that shows it.
 * In memory only: it never outlives the page, and it's taken exactly once.
 */
import type { ImportResult } from "./importers";

let pending: ImportResult | null = null;

export function setPendingImport(result: ImportResult): void {
  pending = result;
}

export function takePendingImport(): ImportResult | null {
  const result = pending;
  pending = null;
  return result;
}
