export type RouteView = 'launcher' | 'capture' | 'pin';

export type ParsedRoute = {
  view: RouteView;
  params: URLSearchParams;
};

export function parseRoute(route: string = window.location.hash): ParsedRoute {
  if (!route) {
    return {
      view: 'launcher',
      params: new URLSearchParams(),
    };
  }

  const normalizedRoute = route.startsWith('#') ? route.slice(1) : route;
  const [path = '', query = ''] = normalizedRoute.split('?', 2);
  const view = path.replace(/^\//, '');

  if (view === 'capture' || view === 'pin') {
    return {
      view,
      params: new URLSearchParams(query),
    };
  }

  return {
    view: 'launcher',
    params: new URLSearchParams(),
  };
}

export function buildPluginUrl(
  view: RouteView,
  params: Record<string, string>,
  baseUrl: string,
): string {
  const search = new URLSearchParams(params).toString();
  return `${baseUrl}#/${view}${search ? `?${search}` : ''}`;
}
