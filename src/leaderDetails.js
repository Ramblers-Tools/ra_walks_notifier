const leaderDetailsScript = `
(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const checked = Array.from(document.querySelectorAll('#ramled-group-nominated input:checked, input[name^="ramled-group-nominated"]:checked'));
  for (const input of checked) {
    const row = input.closest('tr, .form-item, li, div');
    const rowText = clean(row ? row.innerText : '');
    const value = clean(input.value);
    const name = clean(rowText.replace(/Primary walk leader|Contact Preferences|Walk leaders|Name/g, ''));
    if (name && !/^\\d+$/.test(name)) {
      return { leaderFullName: name, leaderVolunteerId: value };
    }
  }

  const body = clean(document.body ? document.body.innerText : '');
  const ledBy = body.match(/Led by:\\s*([^\\n\\r]+?)(?:\\s{2,}|$)/i);
  if (ledBy && ledBy[1]) return { leaderFullName: clean(ledBy[1]), leaderVolunteerId: '' };

  return { leaderFullName: '', leaderVolunteerId: '' };
})()
`;

const managerEditHrefScript = `
(() => {
  const link = Array.from(document.querySelectorAll('a[href*="/walks-manager/walk/"]'))
    .find(anchor => /\\/walks-manager\\/walk\\/(basic-information|description|details|meet-start-point|shape|media|publishing)\\//.test(anchor.href || anchor.getAttribute('href') || ''));
  return link ? link.href : '';
})()
`;

async function extractLeaderDetailsFromPlaywright(page) {
  return page.evaluate(leaderDetailsScript).catch(() => ({ leaderFullName: '', leaderVolunteerId: '' }));
}

async function extractManagerEditHrefFromPlaywright(page) {
  return page.evaluate(managerEditHrefScript).catch(() => '');
}

module.exports = {
  leaderDetailsScript,
  managerEditHrefScript,
  extractLeaderDetailsFromPlaywright,
  extractManagerEditHrefFromPlaywright
};
