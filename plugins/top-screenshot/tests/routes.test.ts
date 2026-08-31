import { describe, expect, it } from 'vitest';

describe('routes', () => {
  it('parses an empty route as the launcher view with no params', async () => {
    const { parseRoute } = await import('../src/core/routes');

    const route = parseRoute('');

    expect(route.view).toBe('launcher');
    expect(route.params).toBeInstanceOf(URLSearchParams);
    expect([...route.params.entries()]).toEqual([]);
  });

  it('reads window.location.hash when no route is provided', async () => {
    const { parseRoute } = await import('../src/core/routes');
    window.location.hash = '#/pin?id=p1';

    const route = parseRoute();

    expect(route.view).toBe('pin');
    expect(route.params.get('id')).toBe('p1');
  });

  it('parses a capture hash route and exposes its search params', async () => {
    const { parseRoute } = await import('../src/core/routes');

    const route = parseRoute('#/capture?sessionId=s1&displayId=d1');

    expect(route.view).toBe('capture');
    expect(route.params.get('sessionId')).toBe('s1');
    expect(route.params.get('displayId')).toBe('d1');
  });

  it('falls back unknown hash routes to launcher with no params', async () => {
    const { parseRoute } = await import('../src/core/routes');

    const route = parseRoute('#/unknown?x=1');

    expect(route.view).toBe('launcher');
    expect([...route.params.entries()]).toEqual([]);
  });

  it('builds a plugin url by appending a hash route and encoded params', async () => {
    const { buildPluginUrl } = await import('../src/core/routes');

    expect(
      buildPluginUrl('pin', { id: 'abc 123' }, 'file:///D:/plugin/dist/index.html'),
    ).toBe('file:///D:/plugin/dist/index.html#/pin?id=abc+123');
  });
});
