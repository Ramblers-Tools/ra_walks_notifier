function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function stableId(walk) {
  return walk.href || `${walk.groupName}|${walk.title}|${walk.date}|${walk.leader}`;
}

function absoluteHref(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return `https://walks-manager.ramblers.org.uk${href}`;
  return href;
}

function managerHrefFromEntry(entry) {
  return absoluteHref(entry.managerHref || '');
}

const managerLinkSelector = 'a[href*="/walks-manager/walk/"]';

function parseWalkEntries(entries, groupName) {
  const statusRegex = /Submitted for checking|Awaiting publishing|Ready to publish/i;
  const found = [];
  const seen = new Set();

  for (const entry of entries) {
    const href = absoluteHref(entry.href || '');
    const title = clean(entry.title || '');
    if (!title) continue;

    let text = clean(entry.text || '');
    if (!statusRegex.test(text)) continue;

    // Keep only the section around this specific walk, because some layouts place several
    // walk cards under one larger parent container.
    const titleIndex = text.indexOf(title);
    if (titleIndex > 0) text = text.slice(Math.max(0, titleIndex - 120));

    const status = (text.match(statusRegex) || ['Submitted for checking'])[0];
    const date = clean((text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm)?/i) || [''])[0]);
    const leader = clean((text.match(/Led by:\s*([^\n\r]+?)(?:\s{2,}|$)/i) || [,''])[1]) || clean((text.match(/Leader:\s*([^\n\r]+?)(?:\s{2,}|$)/i) || [,''])[1]);

    const walk = { groupName, title, date, leader, status, href, managerHref: managerHrefFromEntry(entry), id: '' };
    walk.id = stableId(walk);
    if (!seen.has(walk.id)) {
      seen.add(walk.id);
      found.push(walk);
    }
  }

  return found;
}

async function parseWalks(page, groupName) {
  // Walk cards in List View contain a public walk link like /go-walking/group-walks/...
  // Earlier v3 looked at broad div/article ancestors, which could capture the whole page
  // and create false "all groups" entries. Starting from the walk title links is much safer.
  const links = page.locator('a[href*="/go-walking/group-walks/"]');
  const count = await links.count();
  const entries = [];

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute('href').catch(() => '');
    const title = clean(await link.innerText().catch(() => ''));
    if (!title) continue;

    const card = link.locator('xpath=ancestor::*[contains(normalize-space(.), "Submitted for checking") or contains(normalize-space(.), "Awaiting publishing") or contains(normalize-space(.), "Ready to publish")][1]');
    const cardCount = await card.count().catch(() => 0);
    if (!cardCount) continue;

    const cardElement = card.first();
    let managerHref = await cardElement.locator(managerLinkSelector).first().getAttribute('href').catch(() => '');
    if (!managerHref) {
      const broaderCard = link.locator('xpath=ancestor::*[.//a[contains(@href, "/walks-manager/walk/")]][1]');
      managerHref = await broaderCard.locator(managerLinkSelector).first().getAttribute('href').catch(() => '');
    }
    entries.push({ href, title, managerHref, text: await cardElement.innerText().catch(() => '') });
  }

  return parseWalkEntries(entries, groupName);
}

module.exports = { parseWalks, parseWalkEntries, stableId };
