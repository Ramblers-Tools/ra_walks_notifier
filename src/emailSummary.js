function htmlEscape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function plural(count, singular, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function summaryParts(newWalks, changedWalks, clearedWalks, currentWalks) {
  const alreadyNotified = Math.max(0, currentWalks.length - newWalks.length - changedWalks.length);
  const parts = [];

  if (newWalks.length) parts.push(plural(newWalks.length, 'new walk'));
  if (changedWalks.length) parts.push(plural(changedWalks.length, 'changed walk'));
  if (clearedWalks.length) parts.push(plural(clearedWalks.length, 'cleared walk'));

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
  if (clearedWalks.length) lines.push(`\nCleared walks: ${clearedWalks.length}`);
  for (const w of clearedWalks) lines.push(`- ${w.title}`);
  lines.push('\nReview list: https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1');
  const text = lines.join('\n');
  const rows = [...newWalks.map(w=>['New',w]), ...changedWalks.map(w=>['Changed',w]), ...clearedWalks.map(w=>['Cleared',w])]
    .map(([kind,w]) => `<tr><td>${htmlEscape(kind)}</td><td><strong>${htmlEscape(w.title)}</strong><br>${htmlEscape(w.date)}<br>Leader: ${htmlEscape(w.leader)}<br>Status: ${htmlEscape(w.status)}${w.href ? `<br><a href="${htmlEscape(w.href)}">Open walk</a>` : ''}</td></tr>`).join('');
  const html = `<p>${htmlEscape(leadSentence)}</p><table border="1" cellpadding="8" cellspacing="0">${rows}</table><p><a href="https://walks-manager.ramblers.org.uk/walks-manager/list?gid=414&review=1">Open review list</a></p>`;
  return { text, html };
}

module.exports = { buildEmail, buildLeadSentence };
