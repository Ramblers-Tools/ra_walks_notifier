const fs = require('fs');
const path = require('path');
const { paths: defaultPaths } = require('./config');

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function appConfig(paths = defaultPaths) {
  return readJson(paths.configFile, readJson(paths.rootConfigFile, {}));
}

function logoPath(config, paths = defaultPaths) {
  if (config === undefined) config = appConfig(paths);
  const configured = String(config.branding?.logoPath || '').trim();
  if (configured && fs.existsSync(configured)) return configured;

  for (const ext of imageExtensions) {
    const candidate = path.join(paths.brandingDir, `logo${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const file of ['ramblers-logo.png', 'ramblers-logo.svg']) {
    const candidate = path.join(paths.rootDir, 'assets', file);
    if (fs.existsSync(candidate)) return candidate;
  }

  return '';
}

function logoDataUrl(config, paths = defaultPaths) {
  if (config === undefined) config = appConfig(paths);
  const file = logoPath(config, paths);
  if (!file) return '';

  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.svg'
      ? 'image/svg+xml'
      : `image/${ext.replace('.', '')}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function copyLogo(sourceFile, paths = defaultPaths) {
  const ext = path.extname(sourceFile).toLowerCase();
  if (!imageExtensions.has(ext)) {
    throw new Error('Choose a PNG, JPG, GIF, WebP, or SVG image.');
  }

  fs.mkdirSync(paths.brandingDir, { recursive: true });
  const destination = path.join(paths.brandingDir, `logo${ext}`);
  fs.copyFileSync(sourceFile, destination);
  return destination;
}

// Same as copyLogo, but for bytes received directly (e.g. an API upload)
// rather than an existing file on disk.
function saveLogoBuffer(buffer, ext, paths = defaultPaths) {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  if (!imageExtensions.has(normalizedExt)) {
    throw new Error('Choose a PNG, JPG, GIF, WebP, or SVG image.');
  }

  fs.mkdirSync(paths.brandingDir, { recursive: true });
  for (const existingExt of imageExtensions) {
    const existing = path.join(paths.brandingDir, `logo${existingExt}`);
    if (fs.existsSync(existing)) fs.unlinkSync(existing);
  }
  const destination = path.join(paths.brandingDir, `logo${normalizedExt}`);
  fs.writeFileSync(destination, buffer);
  return destination;
}

function removeLogo(paths = defaultPaths) {
  for (const ext of imageExtensions) {
    const existing = path.join(paths.brandingDir, `logo${ext}`);
    if (fs.existsSync(existing)) fs.unlinkSync(existing);
  }
}

module.exports = { copyLogo, saveLogoBuffer, removeLogo, logoDataUrl, logoPath, appConfig };
