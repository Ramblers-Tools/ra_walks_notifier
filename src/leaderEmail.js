const { sendEmail } = require('./email');
const { log } = require('./logger');

function normalizeLeaderEmailSettings(config = {}) {
  const settings = config.leaderEmails || {};
  return {
    enabled: settings.enabled !== false,
    sendOnSubmit: settings.sendOnSubmit !== false,
    sendOnPublish: settings.sendOnPublish !== false,
    apiBaseUrl: String(settings.apiBaseUrl || '').trim().replace(/\/$/, ''),
    apiToken: String(settings.apiToken || '').trim()
  };
}

function leaderEmailConfigured(config = {}) {
  const settings = normalizeLeaderEmailSettings(config);
  return Boolean(settings.enabled && settings.apiBaseUrl && settings.apiToken);
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function displayName(walk) {
  return String(walk.leaderFullName || walk.leader || '').replace(/\s+/g, ' ').trim();
}

async function lookupLeaderEmail(name, settings) {
  if (!name || !settings.apiBaseUrl || !settings.apiToken) return { email: '', reason: 'not configured' };
  const url = `${settings.apiBaseUrl}/ra_mailman/profiles?filter_search=${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/json',
      'X-Joomla-Token': settings.apiToken
    }
  });

  if (!response.ok) {
    throw new Error(`Leader lookup failed with HTTP ${response.status}`);
  }

  const json = await response.json();
  const records = Array.isArray(json.data) ? json.data : [];
  const exact = records.filter(record => normalizeName(record.attributes?.preferred_name) === normalizeName(name));
  const candidates = exact.length ? exact : records;

  if (candidates.length !== 1) {
    return { email: '', reason: `${candidates.length} matching leader profiles` };
  }

  const email = String(candidates[0].attributes?.email || '').trim();
  return email ? { email, record: candidates[0] } : { email: '', reason: 'matching profile has no email' };
}

function submittedSubject(walk) {
  return `Thank you for submitting ${walk.title}`;
}

function publishedSubject(walk) {
  return `Your walk has been published: ${walk.title}`;
}

function leaderEmailHtml(title, paragraphs, walk) {
  const body = paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.5;">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17212b;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #d8dee8;border-radius:8px;overflow:hidden;">
        <div style="padding:20px 24px;background:#173b2f;color:#ffffff;">
          <img src="cid:walks-manager-watch-logo" width="140" alt="Ramblers" style="display:block;max-width:140px;height:auto;">
          <h1 style="margin:16px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:20px 24px;">
          ${body}
          <div style="margin-top:18px;padding:14px;border:1px solid #d8dee8;border-radius:6px;background:#fafbfc;">
            <strong>${escapeHtml(walk.title)}</strong><br>
            ${escapeHtml(walk.date || '')}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendLeaderSubmittedEmail(walk, email) {
  const name = displayName(walk) || 'there';
  const text = [
    `Hello ${name},`,
    '',
    `Thank you for submitting your walk "${walk.title}".`,
    'Your walk has been received and is now being reviewed by the walks team.',
    'Thanks for volunteering as a walk leader.',
    '',
    walk.date || ''
  ].join('\n');
  const html = leaderEmailHtml('Walk submitted', [
    `Hello ${name},`,
    `Thank you for submitting your walk "${walk.title}". Your walk has been received and is now being reviewed by the walks team.`,
    'Thanks for volunteering as a walk leader.'
  ], walk);

  await sendEmail(submittedSubject(walk), text, html, { to: [email] });
}

async function sendLeaderPublishedEmail(walk, email) {
  const name = displayName(walk) || 'there';
  const text = [
    `Hello ${name},`,
    '',
    `Your walk "${walk.title}" has now been published.`,
    'Thank you for leading walks and supporting the group programme.',
    '',
    walk.date || ''
  ].join('\n');
  const html = leaderEmailHtml('Walk published', [
    `Hello ${name},`,
    `Your walk "${walk.title}" has now been published.`,
    'Thank you for leading walks and supporting the group programme.'
  ], walk);

  await sendEmail(publishedSubject(walk), text, html, { to: [email] });
}

function shouldSendSubmitted(walk) {
  return /Submitted for checking/i.test(walk.status || '');
}

function shouldSendPublished(walk) {
  return /Awaiting publishing|Ready to publish/i.test(walk.status || '');
}

async function sendLeaderEmails({ newWalks, clearedWalks, state, config }) {
  const settings = normalizeLeaderEmailSettings(config);
  const result = { sent: 0, skipped: 0 };
  if (!leaderEmailConfigured(config)) return result;

  state.leaderEmails = state.leaderEmails || { submitted: {}, published: {} };
  state.leaderEmails.submitted = state.leaderEmails.submitted || {};
  state.leaderEmails.published = state.leaderEmails.published || {};

  if (settings.sendOnSubmit) {
    for (const walk of newWalks) {
      if (!shouldSendSubmitted(walk) || state.leaderEmails.submitted[walk.id]) continue;
      await sendLeaderEmailForWalk(walk, settings, 'submitted', state.leaderEmails.submitted, result);
    }
  }

  if (settings.sendOnPublish) {
    for (const walk of clearedWalks) {
      if (!shouldSendPublished(walk) || state.leaderEmails.published[walk.id]) continue;
      await sendLeaderEmailForWalk(walk, settings, 'published', state.leaderEmails.published, result);
    }
  }

  return result;
}

async function sendLeaderEmailForWalk(walk, settings, kind, bucket, result) {
  const name = displayName(walk);
  if (!name) {
    log(`Leader ${kind} email skipped for ${walk.title}: no full leader name.`);
    result.skipped += 1;
    return;
  }

  try {
    const lookup = await lookupLeaderEmail(name, settings);
    if (!lookup.email) {
      log(`Leader ${kind} email skipped for ${name}: ${lookup.reason}.`);
      result.skipped += 1;
      return;
    }

    if (kind === 'published') await sendLeaderPublishedEmail(walk, lookup.email);
    else await sendLeaderSubmittedEmail(walk, lookup.email);

    bucket[walk.id] = { sentAt: new Date().toISOString(), email: lookup.email, name };
    result.sent += 1;
    log(`Leader ${kind} email sent to ${name} <${lookup.email}>.`);
  } catch (error) {
    log(`Leader ${kind} email failed for ${name}: ${error.message}`);
    result.skipped += 1;
  }
}

module.exports = {
  normalizeLeaderEmailSettings,
  leaderEmailConfigured,
  lookupLeaderEmail,
  sendLeaderEmails,
  shouldSendSubmitted,
  shouldSendPublished
};
