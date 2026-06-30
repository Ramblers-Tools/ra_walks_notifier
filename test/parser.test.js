const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWalks, stableId } = require('../src/parser');

test('parseWalks reads pending walk cards from Walks Manager links', async () => {
  const page = fakePage([
    {
      href: '/go-walking/group-walks/macclesfield-forest',
      title: 'Macclesfield Forest',
      cardText: [
        'Submitted for checking',
        'Macclesfield Forest',
        'Saturday 12th July 2026 at 10:30 am',
        'Led by: Jane Walker'
      ].join('\n')
    },
    {
      href: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/shining-tor',
      title: 'Shining Tor',
      cardText: [
        'Ready to publish',
        'Shining Tor',
        'Sunday 13th July 2026 at 9:45 am',
        'Leader: John Rambler'
      ].join('\n')
    }
  ]);

  const walks = await parseWalks(page, 'East Cheshire Group');

  assert.deepEqual(walks, [
    {
      groupName: 'East Cheshire Group',
      title: 'Macclesfield Forest',
      date: 'Saturday 12th July 2026 at 10:30 am',
      leader: 'Jane Walker',
      status: 'Submitted for checking',
      href: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/macclesfield-forest',
      managerHref: '',
      id: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/macclesfield-forest'
    },
    {
      groupName: 'East Cheshire Group',
      title: 'Shining Tor',
      date: 'Sunday 13th July 2026 at 9:45 am',
      leader: 'John Rambler',
      status: 'Ready to publish',
      href: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/shining-tor',
      managerHref: '',
      id: 'https://walks-manager.ramblers.org.uk/go-walking/group-walks/shining-tor'
    }
  ]);
});

test('parseWalks captures manager detail links from review cards', async () => {
  const page = fakePage([
    {
      href: '/go-walking/group-walks/test-walk',
      managerHref: '/walks-manager/walk/basic-information/83c25f50-545a-413e-b0b1-b2aab2784648',
      title: 'Test walk',
      cardText: [
        'Submitted for checking',
        'Test walk',
        'Saturday 12th July 2026 at 10:30 am',
        'Led by: Richard H.'
      ].join('\n')
    }
  ]);

  const walks = await parseWalks(page, 'East Cheshire Group');

  assert.equal(
    walks[0].managerHref,
    'https://walks-manager.ramblers.org.uk/walks-manager/walk/basic-information/83c25f50-545a-413e-b0b1-b2aab2784648'
  );
});

test('parseWalks ignores links without a pending review status', async () => {
  const page = fakePage([
    {
      href: '/go-walking/group-walks/already-live',
      title: 'Already Live',
      cardText: 'Already Live Sunday 13th July 2026 at 9:45 am Led by: Jane Walker'
    }
  ]);

  assert.deepEqual(await parseWalks(page, 'East Cheshire Group'), []);
});

test('stableId falls back to walk fields when there is no href', () => {
  assert.equal(
    stableId({
      groupName: 'East Cheshire Group',
      title: 'Macclesfield Forest',
      date: 'Saturday 12th July 2026 at 10:30 am',
      leader: 'Jane Walker',
      href: ''
    }),
    'East Cheshire Group|Macclesfield Forest|Saturday 12th July 2026 at 10:30 am|Jane Walker'
  );
});

function fakePage(entries) {
  return {
    locator(selector) {
      assert.equal(selector, 'a[href*="/go-walking/group-walks/"]');
      return fakeLinks(entries);
    }
  };
}

function fakeLinks(entries) {
  return {
    async count() {
      return entries.length;
    },
    nth(index) {
      return fakeLink(entries[index]);
    }
  };
}

function fakeLink(entry) {
  return {
    async getAttribute(name) {
      assert.equal(name, 'href');
      return entry.href;
    },
    async innerText() {
      return entry.title;
    },
    locator() {
      return fakeCard(entry.cardText, entry.managerHref || '');
    }
  };
}

function fakeCard(text, managerHref = '') {
  const hasStatus = /Submitted for checking|Awaiting publishing|Ready to publish/i.test(text);

  return {
    async count() {
      return hasStatus ? 1 : 0;
    },
    first() {
      return {
        locator() {
          return fakeManagerLink(managerHref);
        },
        async innerText() {
          return text;
        }
      };
    }
  };
}

function fakeManagerLink(href) {
  return {
    first() {
      return {
        async getAttribute(name) {
          assert.equal(name, 'href');
          return href;
        }
      };
    }
  };
}
