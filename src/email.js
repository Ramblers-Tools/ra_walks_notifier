const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { paths, resolveSmtp } = require('./config');
const { logoPath } = require('./branding');

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function emailSettings() {
  return resolveSmtp(readJson(paths.configFile, readJson(paths.rootConfigFile, {})), process.env);
}

function validateEmailConfig(settings) {
  const missing = [];
  for (const key of ['host', 'port', 'user', 'pass']) {
    if (!settings[key]) missing.push(key);
  }
  if (!settings.to.length) missing.push('to');
  if (missing.length) {
    throw new Error(`Missing email configuration: ${missing.join(', ')}. Check setup email settings.`);
  }
}

function formatFromAddress(name, address) {
  const trimmedName = String(name || '').trim();
  const trimmedAddress = String(address || '').trim();
  if (!trimmedName || /^.+<.+>$/.test(trimmedAddress)) return trimmedAddress;
  return `"${trimmedName.replace(/"/g, '\\"')}" <${trimmedAddress}>`;
}

async function sendEmail(subject, text, html, options = {}) {
  const smtp = emailSettings();
  validateEmailConfig(smtp);
  const logo = logoPath() || path.join(paths.rootDir, 'assets', 'trayTemplate.png');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass }
  });
  const message = {
    from: formatFromAddress(smtp.fromName, smtp.from),
    to: (options.to || smtp.to).join(', '),
    subject,
    text,
    html
  };

  if (html && logo) {
    message.attachments = [{
      filename: 'logo.png',
      path: logo,
      cid: 'walks-manager-watch-logo'
    }];
  }

  await transporter.sendMail(message);
}

module.exports = { sendEmail, formatFromAddress };
