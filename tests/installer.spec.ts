import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { installCodexPreset } from '../src/installer.ts'

describe('Codex preset installer', () => {
  it('installs the complete preset atomically and preserves an existing preset', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-codex-'))
    const target = join(root, '.agent-presets', 'codex')
    try {
      installCodexPreset(target)
      expect(existsSync(join(target, 'agent.cordis.yml'))).toBe(true)
      expect(existsSync(join(target, 'preset.yml'))).toBe(true)
      const composition = readFileSync(join(target, 'agent.cordis.yml'), 'utf8')
      expect(composition).toContain("name: '@shuind/dsh-codex-harness'")
      expect(composition).toContain("name: '@deepseek-ai/dsh-compaction-basic'")
      expect(composition).toContain("name: '@deepseek-ai/dsh-command-compact'")

      const custom = 'name: user-owned\n'
      writeFileSync(join(target, 'preset.yml'), custom)
      installCodexPreset(target)
      expect(readFileSync(join(target, 'preset.yml'), 'utf8')).toBe(custom)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
