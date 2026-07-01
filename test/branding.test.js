const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { saveLogoBuffer, removeLogo, logoPath, logoDataUrl } = require('../src/branding');

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmw-branding-test-'));
  return { brandingDir: path.join(dir, 'branding'), rootDir: path.resolve(__dirname, '..') };
}

test('saveLogoBuffer writes the image and logoPath finds it', () => {
  const paths = tempPaths();
  saveLogoBuffer(Buffer.from('fake-png-bytes'), 'png', paths);
  const found = logoPath({}, paths);
  assert.ok(found.endsWith('logo.png'));
  assert.equal(fs.readFileSync(found, 'utf8'), 'fake-png-bytes');
});

test('saveLogoBuffer rejects unsupported extensions', () => {
  const paths = tempPaths();
  assert.throws(() => saveLogoBuffer(Buffer.from('x'), 'exe', paths));
});

test('saveLogoBuffer replaces a previously uploaded logo of a different extension', () => {
  const paths = tempPaths();
  saveLogoBuffer(Buffer.from('first'), 'png', paths);
  saveLogoBuffer(Buffer.from('second'), 'jpg', paths);
  assert.equal(fs.existsSync(path.join(paths.brandingDir, 'logo.png')), false);
  assert.equal(fs.readFileSync(path.join(paths.brandingDir, 'logo.jpg'), 'utf8'), 'second');
});

test('removeLogo clears any uploaded logo so logoPath falls back to the default', () => {
  const paths = tempPaths();
  saveLogoBuffer(Buffer.from('custom'), 'png', paths);
  removeLogo(paths);
  const found = logoPath({}, paths);
  assert.ok(found.includes('ramblers-logo'));
});

test('logoDataUrl encodes the uploaded logo as a base64 data URL', () => {
  const paths = tempPaths();
  saveLogoBuffer(Buffer.from('hello'), 'png', paths);
  const url = logoDataUrl({}, paths);
  assert.ok(url.startsWith('data:image/png;base64,'));
  assert.equal(Buffer.from(url.split(',')[1], 'base64').toString('utf8'), 'hello');
});
