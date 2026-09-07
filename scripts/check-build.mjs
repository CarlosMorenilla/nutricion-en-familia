import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = 'dist/client';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
const names = files(root);
assert.ok(names.some(n => n.endsWith('index.html')));
assert.ok(names.some(n => n.endsWith('_headers')));
for (const file of names) {
  assert.ok(!/private|schema\.sql|\.env|borradores-iniciales|\.map$/.test(file), 'Private/build-only file in deployment: ' + file);
  if (/\.(html|js|css|json|txt)$/.test(file)) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook)\.[a-z]+/i.test(text), 'Personal email in deployment');
    assert.ok(!/sb_secret_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]{20,}/.test(text), 'Secret token in deployment');
  }
}
console.log('Static deployment checked: ' + names.length + ' files; private paths and credential patterns checked.');
