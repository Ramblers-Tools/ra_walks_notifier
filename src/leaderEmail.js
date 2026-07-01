const { sendEmail } = require('./email');
const { log } = require('./logger');

function normalizeEmailList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  return list.map(entry => String(entry || '').trim()).filter(Boolean);
}

function normalizeLeaderEmailSettings(config = {}) {
  const settings = config.leaderEmails || {};
  const lookupFailureNotifyAddress = String(settings.lookupFailureNotifyAddress || '').trim();
  return {
    enabled: settings.enabled === true,
    sendOnSubmit: settings.sendOnSubmit !== false,
    sendOnPublish: settings.sendOnPublish !== false,
    apiBaseUrl: String(settings.apiBaseUrl || '').trim().replace(/\/$/, ''),
    apiToken: String(settings.apiToken || '').trim(),
    notifyOnLookupFailure: settings.notifyOnLookupFailure === true && Boolean(lookupFailureNotifyAddress),
    lookupFailureNotifyAddress,
    testModeEnabled: settings.testModeEnabled === true,
    testAllowedEmails: normalizeEmailList(settings.testAllowedEmails)
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

function firstName(walk) {
  return displayName(walk).split(' ')[0] || '';
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

async function testLeaderEmailApi(settings, name = 'Richard Higham') {
  const normalized = normalizeLeaderEmailSettings({ leaderEmails: settings || {} });
  const searchName = String(name || '').replace(/\s+/g, ' ').trim();
  if (!normalized.apiBaseUrl || !normalized.apiToken) {
    return { ok: false, message: 'Enter the Joomla API URL and token first.' };
  }
  if (!searchName) {
    return { ok: false, message: 'Enter a leader name to test.' };
  }

  try {
    const lookup = await lookupLeaderEmail(searchName, normalized);
    if (!lookup.email) {
      return { ok: false, message: `API connected, but ${lookup.reason} for ${searchName}.` };
    }

    const profileName = lookup.record?.attributes?.preferred_name || searchName;
    return { ok: true, message: `API connected. Found ${profileName} <${lookup.email}>.` };
  } catch (error) {
    return { ok: false, message: `API test failed: ${error.message}` };
  }
}

function submittedSubject(walk) {
  return `Thank you for submitting ${walk.title}`;
}

function publishedSubject(walk) {
  return `Your walk has been published: ${walk.title}`;
}

function leaderEmailHtml(title, paragraphs, walk, options = {}) {
  const headerBackground = options.headerBackground || '#173b2f';
  const body = paragraphs.map(p => `<p style="margin:0 0 14px;line-height:1.5;">${typeof p === 'object' && p.html ? p.html : escapeHtml(p)}</p>`).join('');
  const afterDetails = (options.afterDetails || [])
    .map(note => `<p style="margin:14px 0 0;line-height:1.5;${note.red ? 'color:#c0392b;font-weight:600;' : ''}">${note.html}</p>`)
    .join('');
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17212b;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #d8dee8;border-radius:8px;overflow:hidden;">
        <div style="padding:20px 24px;background:${headerBackground};color:#ffffff;">
          <img src="cid:walks-manager-watch-logo" width="140" alt="Ramblers" style="display:block;max-width:140px;height:auto;">
          <h1 style="margin:16px 0 0;font-size:22px;line-height:1.25;">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:20px 24px;">
          ${body}
          <div style="margin-top:18px;padding:14px;border:1px solid #d8dee8;border-radius:6px;background:#fafbfc;">
            <strong>${escapeHtml(walk.title)}</strong><br>
            ${escapeHtml(walk.date || '')}
          </div>
          ${afterDetails}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CONTACT_PREFERENCES_URL = 'https://walks-manager.ramblers.org.uk/user/contact-preferences';
const CONTACT_PREFERENCE_LABELS = { phone: 'phone number', email: 'email address', personalInfo: 'display name' };

function missingContactPreferences(walk) {
  const prefs = walk.leaderContactPreferences;
  if (!prefs) return [];
  return Object.keys(CONTACT_PREFERENCE_LABELS).filter(key => !prefs[key]);
}

function contactPreferencesListText(missing) {
  const labels = missing.map(key => CONTACT_PREFERENCE_LABELS[key]);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
}

function contactPreferenceNotes(missing) {
  const notes = [];

  if (missing.includes('personalInfo')) {
    const text = 'We recommend sharing at least your name with walkers (please note the public listing will not show your full name, but your first name and the first initial of your surname, for example "John S.").';
    const html = 'We recommend sharing at least your name with walkers (please note the public listing will not show your full name, but your first name and the first initial of your surname, for example &quot;John S.&quot;).';
    notes.push({ text, html, red: true });
  }

  const otherMissing = missing.filter(key => key !== 'personalInfo');
  if (otherMissing.length) {
    const list = contactPreferencesListText(otherMissing);
    const verb = otherMissing.length > 1 ? 'are' : 'is';
    const also = missing.includes('personalInfo') ? ' also' : '';
    const text = `Your ${list} ${verb}${also} currently not shared with walkers.`;
    const html = `Your ${escapeHtml(list)} ${verb}${also} currently not shared with walkers.`;
    notes.push({ text, html, red: false });
  }

  if (notes.length) {
    notes.push({
      text: `You can update your preferences here: ${CONTACT_PREFERENCES_URL}`,
      html: `You can update your preferences <a href="${CONTACT_PREFERENCES_URL}">here</a>.`,
      red: false
    });
  }

  return notes;
}

async function sendLeaderSubmittedEmail(walk, email) {
  const name = firstName(walk) || 'there';
  const missing = missingContactPreferences(walk);
  const notes = contactPreferenceNotes(missing);
  const text = [
    `Hi ${name},`,
    '',
    `Thank you for submitting your walk "${walk.title}".`,
    'Your walk has been received and is now being reviewed by the walks team.',
    "Thanks for stepping up as a walk leader — it's a big help to the group, and we appreciate you taking the time to plan and lead walks.",
    '',
    walk.date || '',
    ...notes.flatMap(note => ['', note.text])
  ].join('\n');
  const html = leaderEmailHtml('Walk submitted', [
    `Hi ${name},`,
    `Thank you for submitting your walk "${walk.title}". Your walk has been received and is now being reviewed by the walks team.`,
    "Thanks for stepping up as a walk leader — it's a big help to the group, and we appreciate you taking the time to plan and lead walks."
  ], walk, { headerBackground: '#5f6872', afterDetails: notes });

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
  ], walk, { headerBackground: '#173b2f' });

  await sendEmail(publishedSubject(walk), text, html, { to: [email] });
}

function shouldSendSubmitted(walk) {
  return /Submitted for checking/i.test(walk.status || '');
}

function shouldSendPublished(walk, state = {}) {
  if (/Awaiting publishing|Ready to publish/i.test(walk.status || '')) return true;
  return Boolean(state.leaderEmails?.submitted?.[walk.id]);
}

function htmlToText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function confirmWalkPublished(walk) {
  const href = String(walk.href || '').trim();
  if (!href) return { ok: false, reason: 'no public walk link' };

  const response = await fetch(href, { headers: { Accept: 'text/html' } });
  if (!response.ok) return { ok: false, reason: `public walk page returned HTTP ${response.status}` };

  const text = htmlToText(await response.text());
  const title = String(walk.title || '').trim();
  if (/page not found|not found|access denied|permission denied/i.test(text)) {
    return { ok: false, reason: 'public walk page was not available' };
  }
  if (title && !normalizeName(text).includes(normalizeName(title))) {
    return { ok: false, reason: 'public walk page did not match the cleared walk' };
  }

  return { ok: true };
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
      if (!shouldSendPublished(walk, state) || state.leaderEmails.published[walk.id]) continue;
      const published = await confirmWalkPublished(walk);
      if (!published.ok) {
        log(`Leader published email skipped for ${walk.title}: ${published.reason}.`);
        result.skipped += 1;
        continue;
      }
      await sendLeaderEmailForWalk(walk, settings, 'published', state.leaderEmails.published, result);
    }
  }

  return result;
}

async function sendLeaderLookupFailureEmail(walk, kind, name, reason, notifyAddress) {
  const subject = `Walks Manager Watch: leader email lookup failed for ${walk.title}`;
  const text = [
    `The ${kind} email for walk "${walk.title}" could not be sent because the leader's email address could not be resolved.`,
    '',
    `Leader name: ${name}`,
    `Reason: ${reason}`,
    `Walk: ${walk.title}`,
    walk.date || ''
  ].join('\n');
  await sendEmail(subject, text, `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`, { to: [notifyAddress] });
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
      if (settings.notifyOnLookupFailure && settings.lookupFailureNotifyAddress) {
        await sendLeaderLookupFailureEmail(walk, kind, name, lookup.reason, settings.lookupFailureNotifyAddress);
      }
      return;
    }

    if (settings.testModeEnabled && !isAllowedTestLeaderEmail(lookup.email, settings)) {
      log(`Leader ${kind} email skipped for ${name}: ${lookup.email} is not in the test allow list.`);
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

function isAllowedTestLeaderEmail(email, settings) {
  const allowed = settings.testAllowedEmails || [];
  return allowed.map(value => String(value).trim().toLowerCase()).includes(String(email || '').trim().toLowerCase());
}

module.exports = {
  normalizeLeaderEmailSettings,
  leaderEmailConfigured,
  lookupLeaderEmail,
  testLeaderEmailApi,
  leaderEmailHtml,
  confirmWalkPublished,
  sendLeaderEmails,
  shouldSendSubmitted,
  shouldSendPublished,
  isAllowedTestLeaderEmail,
  missingContactPreferences,
  contactPreferenceNotes,
  sendLeaderSubmittedEmail
};
