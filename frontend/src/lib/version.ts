// App version. Sourced from package.json at build time so a single bump
// (npm version / direct edit) propagates everywhere — About pane, footer,
// future "what's new" banners. Vite resolves the JSON import natively.
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
