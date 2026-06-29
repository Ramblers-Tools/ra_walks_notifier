const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function appConfig() {
  return readJson(paths.configFile, readJson(paths.rootConfigFile, {}));
}

function logoPath(config = appConfig()) {
  const configured = String(config.branding?.logoPath || '').trim();
  if (configured && fs.existsSync(configured)) return configured;

  for (const ext of imageExtensions) {
    const candidate = path.join(paths.brandingDir, `logo${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return '';
}

function logoDataUrl(config = appConfig()) {
  const file = logoPath(config);
  if (!file) return '';

  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.replace('.', '')}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function copyLogo(sourceFile) {
  const ext = path.extname(sourceFile).toLowerCase();
  if (!imageExtensions.has(ext)) {
    throw new Error('Choose a PNG, JPG, GIF, or WebP image.');
  }

  fs.mkdirSync(paths.brandingDir, { recursive: true });
  const destination = path.join(paths.brandingDir, `logo${ext}`);
  fs.copyFileSync(sourceFile, destination);
  return destination;
}

module.exports = { copyLogo, logoDataUrl, logoPath };
