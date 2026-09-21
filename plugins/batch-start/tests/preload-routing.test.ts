import { describe, it, expect } from 'vitest'
import { routePluginEnter } from '../src/services/enterRouter'

describe('routePluginEnter', () => {
  it('routes manage and group codes', () => {
    expect(routePluginEnter('manage')).toEqual({ type: 'manage' })
    expect(routePluginEnter('group:abc')).toEqual({
      type: 'launch-group',
      groupId: 'group:abc',
    })
  })

  it('defaults undefined and unknown codes to manage', () => {
    expect(routePluginEnter(undefined)).toEqual({ type: 'manage' })
    expect(routePluginEnter('other')).toEqual({ type: 'manage' })
  })
})
