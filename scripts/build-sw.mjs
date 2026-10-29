import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = (await readdir('dist/assets')).map(name => `/assets/${name}`);
files.push('/', '/index.html');
const version = createHash('sha256').update(await readFile('dist/index.html')).digest('hex').slice(0, 16);
await writeFile('dist/sw.js', `
const CACHE = 'nmc-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nmc-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  } else {
    // Vite's preview sets Vary: Origin. These are immutable same-origin
    // application assets, so module CORS headers must not hide a precached hit.
    event.respondWith(caches.match(event.request, { ignoreVary: true }).then(hit => hit || fetch(event.request)));
  }
});
`);
console.log('Offline shell generated:', version);
