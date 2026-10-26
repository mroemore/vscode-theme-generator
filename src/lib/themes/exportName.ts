// Export naming and the `x-themegen` metadata block.
//
// Two things live here, both about what a theme file carries *besides* colour:
//
//  * A filename slug, so `Aurora Night` lands as `aurora-night.json` in the VS Code
//    extension and can be shipped and imported back without a name-collision rule.
//  * The `x-themegen` payload — the inputs, locks and links that produced the palette,
//    so our own import path can offer to reopen a theme (design §6.1).
//
// VS Code's theme loader ignores unknown top-level keys, which is what makes
// `x-themegen` inert there: it is written for us, not for the editor.

import type { Links } from '@/lib/colors/links'
import type { ThemeInputs } from '@/lib/themes/schema'
import { SCHEMA_VERSION } from '@/lib/themes/schema'

/**
 * Lowercase, non-alphanumerics collapsed to single dashes, no leading/trailing dash.
 * An empty result falls back to `'theme'` so a name like `!!!` still yields a file.
 */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'theme'
  )
}

/** The `.json` filename a theme is exported under. */
export function exportFileName(name: string): string {
  return `${slug(name)}.json`
}

/**
 * The `x-themegen` payload: provenance only, never colour. Locks are sorted so two
 * equal lock sets serialise to identical bytes whatever order they were clicked in.
 */
export function metadataFor(
  inputs: ThemeInputs,
  locks: ReadonlySet<string>,
  links: Links
): object {
  return { schemaVersion: SCHEMA_VERSION, inputs, locks: [...locks].sort(), links }
}
