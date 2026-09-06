/**
 * Taking a new build without needing to be launched twice.
 *
 * The service worker is generated with skipWaiting and clientsClaim, so a new one
 * installs and takes over the page as soon as it's found. What it can't do is swap the
 * JavaScript this page already booted with — so without the code here, the launch that
 * *finds* an update still runs the old build and only the launch after it shows the new
 * one. That gap is invisible and produces exactly the wrong conclusion: you go looking
 * for a bug in a feature that shipped and simply isn't loaded yet.
 *
 * `controllerchange` is the moment the new worker takes over, and the only honest
 * signal that this page is now stale.
 */
class UpdateWatch {
  /** A newer build is live and this page is running the old one. */
  ready = $state(false);

  /** The build this page is actually running, so the question is answerable. */
  readonly build = __BUILD_ID__;

  private bootedAt = Date.now();
  private reloading = false;

  start() {
    const sw = navigator.serviceWorker;
    if (!sw) return;

    // No controller yet means this is the first registration, not an update: the page
    // is already the newest thing there is, so claiming it isn't news.
    const hadController = Boolean(sw.controller);

    sw.addEventListener('controllerchange', () => {
      if (!hadController || this.reloading) return;
      // In the first seconds of a launch nothing has been typed and nothing is on
      // screen worth keeping, so swap the build outright — that's the whole point,
      // and it saves the second launch. Later on, a reload could take a half-written
      // message with it, so it becomes an offer instead.
      if (Date.now() - this.bootedAt < 6000) return this.reload();
      this.ready = true;
    });

    // The worker only looks for a new build on navigation, which a standalone app
    // does roughly never. Coming back to the foreground is the natural moment.
    const check = () => {
      if (document.visibilityState === 'visible') void sw.getRegistration().then((r) => r?.update());
    };
    document.addEventListener('visibilitychange', check);
  }

  reload() {
    this.reloading = true;
    location.reload();
  }
}

export const update = new UpdateWatch();
