const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmail, buildLeadSentence } = require('../src/emailSummary');

test('lead sentence separates new walks from already notified walks', () => {
  const lead = buildLeadSentence([walk('New walk')], [], [], [walk('New walk'), walk('Old walk')]);

  assert.equal(lead, 'Walks Manager Watch found 1 new walk. 1 walk already notified.');
});

test('lead sentence hides already notified count when there are none', () => {
  const lead = buildLeadSentence([walk('New walk')], [], [], [walk('New walk')]);

  assert.equal(lead, 'Walks Manager Watch found 1 new walk.');
});

test('email html uses the clearer lead sentence', () => {
  const { html, text } = buildEmail([walk('New walk')], [], [], [walk('New walk'), walk('Old walk')]);

  assert.match(text, /1 new walk\. 1 walk already notified\./);
  assert.match(html, /1 new walk\. 1 walk already notified\./);
  assert.doesNotMatch(html, /2 current pending/);
});

function walk(title) {
  return {
    title,
    date: 'Sunday 12th July 2026 at 1:22 pm',
    leader: 'Richard H.',
    status: 'Submitted for checking',
    href: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/test'
  };
}
