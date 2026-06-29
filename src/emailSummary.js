function htmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function plural(count, singular, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function summaryParts(newWalks, changedWalks, clearedWalks, currentWalks) {
  const alreadyNotified = newWalks.length || changedWalks.length
    ? Math.max(0, currentWalks.length - newWalks.length - changedWalks.length)
    : 0;
  const parts = [];

  if (newWalks.length) parts.push(plural(newWalks.length, 'new walk'));
  if (changedWalks.length) parts.push(plural(changedWalks.length, 'changed walk'));

  return { parts, alreadyNotified };
}

function buildLeadSentence(newWalks, changedWalks, clearedWalks, currentWalks) {
  const { parts, alreadyNotified } = summaryParts(newWalks, changedWalks, clearedWalks, currentWalks);

  if (!parts.length) {
    return `Walks Manager Watch found ${plural(currentWalks.length, 'current pending walk')}.`;
  }

  let sentence = `Walks Manager Watch found ${parts.join(', ')}.`;
  if (alreadyNotified > 0) {
    sentence += ` ${plural(alreadyNotified, 'walk')} already notified.`;
  }

  return sentence;
}

function buildEmail(newWalks, changedWalks, clearedWalks, currentWalks) {
  const leadSentence = buildLeadSentence(newWalks, changedWalks, clearedWalks, currentWalks);
  const lines = [];
  lines.push(leadSentence);
  if (newWalks.length) lines.push(`\nNew walks: ${newWalks.length}`);
  for (const w of newWalks) lines.push(`- ${w.title}\n  ${w.date}\n  Leader: ${w.leader}\n  Status: ${w.status}\n  ${w.href || ''}`);
  if (changedWalks.length) lines.push(`\nChanged walks: ${changedWalks.length}`);
  for (const w of changedWalks) lines.push(`- ${w.title}\n  ${w.date}\n  Leader: ${w.leader}\n  Status: ${w.status}\n  ${w.href || ''}`);
  lines.push('\nReview list: https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1');
  const text = lines.join('\n');
  const rows = [...newWalks.map(w=>['New',w]), ...changedWalks.map(w=>['Changed',w])]
    .map(([kind,w]) => `
      <tr>
        <td style="padding:12px 14px;border-top:1px solid #d8dee8;vertical-align:top;width:86px;">
          <span style="display:inline-block;padding:4px 8px;border-radius:12px;background:${kind === 'New' ? '#e2f4ea' : '#fff2cc'};color:#173b2f;font-size:12px;font-weight:700;">${htmlEscape(kind)}</span>
        </td>
        <td style="padding:12px 14px;border-top:1px solid #d8dee8;vertical-align:top;">
          <div style="font-size:16px;font-weight:700;color:#17212b;margin-bottom:4px;">${htmlEscape(w.title)}</div>
          <div style="font-size:14px;color:#425466;margin-bottom:6px;">${htmlEscape(w.date)}</div>
          <div style="font-size:14px;color:#26323f;">Leader: ${htmlEscape(w.leader || 'Not shown')}</div>
          <div style="font-size:14px;color:#26323f;">Status: ${htmlEscape(w.status)}</div>
          ${w.href ? `<div style="margin-top:8px;"><a href="${htmlEscape(w.href)}" style="color:#1264a3;font-weight:700;">Open walk</a></div>` : ''}
        </td>
      </tr>
    `).join('');
  const logo = '<img src="cid:walks-manager-watch-logo" width="140" alt="Ramblers" style="display:block;max-width:140px;height:auto;">';
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17212b;">
        <div style="max-width:720px;margin:0 auto;padding:24px;">
          <div style="background:#ffffff;border:1px solid #d8dee8;border-radius:8px;overflow:hidden;">
            <div style="padding:20px 24px;background:#173b2f;color:#ffffff;">
              ${logo}
              <h1 style="margin:16px 0 0;font-size:22px;line-height:1.25;">Walks Manager Watch</h1>
            </div>
            <div style="padding:20px 24px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${htmlEscape(leadSentence)}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #d8dee8;border-radius:6px;overflow:hidden;">${rows}</table>
              <p style="margin:20px 0 0;">
                <a href="https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1" style="display:inline-block;background:#1264a3;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;font-weight:700;">Open review list</a>
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>`;
  return { text, html };
}

module.exports = { buildEmail, buildLeadSentence };
