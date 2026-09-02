/** Hash routing: no server rewrites needed on GitHub Pages, and iOS's back
 *  swipe walks the history stack the way you'd expect. */

export type Route =
  | { name: 'today' }
  | { name: 'map' }
  | { name: 'stats' }
  | { name: 'mentor' }
  | { name: 'settings' }
  | { name: 'session'; weekId: string; dayId: string; step: number };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'map':
      return { name: 'map' };
    case 'stats':
      return { name: 'stats' };
    case 'mentor':
      return { name: 'mentor' };
    case 'settings':
      return { name: 'settings' };
    case 'session':
      if (parts[1] && parts[2]) {
        return { name: 'session', weekId: parts[1], dayId: parts[2], step: Number(parts[3] ?? 0) || 0 };
      }
      return { name: 'today' };
    default:
      return { name: 'today' };
  }
}

class Router {
  route = $state<Route>(parse(location.hash));

  constructor() {
    addEventListener('hashchange', () => {
      this.route = parse(location.hash);
      scrollTo({ top: 0 });
    });
  }

  go(path: string) {
    location.hash = path;
  }

  /** Replace rather than push — stepping through a session shouldn't need three
   *  back-swipes to escape. */
  replace(path: string) {
    history.replaceState(null, '', `#${path.replace(/^#/, '')}`);
    this.route = parse(location.hash);
    scrollTo({ top: 0 });
  }

  back() {
    if (history.length > 1) history.back();
    else this.go('/today');
  }
}

export const router = new Router();
export const sessionPath = (weekId: string, dayId: string, step = 0) =>
  `/session/${weekId}/${dayId}/${step}`;
