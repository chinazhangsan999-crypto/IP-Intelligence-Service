import fs from 'node:fs/promises';
import path from 'node:path';

const ASSETS = Object.freeze([
  ['index', 'index.html', 'text/html; charset=utf-8'],
  ['style', 'app.css', 'text/css; charset=utf-8'],
  ['script', 'app.js', 'text/javascript; charset=utf-8'],
]);

export async function loadPublicAssets(directory) {
  const entries = await Promise.all(ASSETS.map(async ([id, filename, contentType]) => {
    const body = await fs.readFile(path.join(directory, filename));
    return [id, Object.freeze({ body, contentType })];
  }));
  return Object.freeze(Object.fromEntries(entries));
}
