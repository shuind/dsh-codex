import { describe, expect, it } from 'vitest'
import { applyCodexRequestSettings } from '../src/index.ts'

describe('Codex request settings', () => {
  it('maps Fast to the priority service tier and carries a context override', () => {
    const result = applyCodexRequestSettings({
      provider: 'relay',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    }, {
      fast: true,
      contextWindow: 131_072,
    })

    expect(result).toMatchObject({
      provider: 'relay',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      contextWindow: 131_072,
      serviceTier: 'priority',
    })
  })

  it('clears stale Codex controls when Fast is off or the route is not GPT', () => {
    expect(applyCodexRequestSettings({
      provider: 'relay',
      model: 'gpt-5.4',
      contextWindow: 64_000,
      serviceTier: 'priority',
    }, { fast: false })).not.toHaveProperty('serviceTier')

    expect(applyCodexRequestSettings({
      provider: 'relay',
      model: 'deepseek-chat',
      contextWindow: 64_000,
      serviceTier: 'priority',
    }, { fast: true, contextWindow: 32_000 })).toEqual({
      provider: 'relay',
      model: 'deepseek-chat',
    })
  })
})
