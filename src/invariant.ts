/**
 * Package-owned invariant companion for `@shuind/dsh-codex`.
 * @module @shuind/dsh-codex/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@shuind/dsh-codex'

/** Codex companion plugin name. */
export const name = 'codex-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Codex has no independent lifecycle stream: its model-visible state is owned
 * by the tool registry and session projection services it consumes.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
