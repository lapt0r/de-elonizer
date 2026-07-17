// Entities that trigger detection when paired with positive sentiment.
const TARGETS = [
  'elon', 'musk', '@elonmusk', 'tesla', 'spacex',
  'twitter/x', 'x.com', 'xai', 'x ai', 'grok',
];

// Positive-sentiment words. Checked per-sentence so "Elon is terrible, brilliant minds disagree"
// does NOT trigger (different sentences).
const POSITIVE_WORDS = [
  'visionary', 'genius', 'brilliant', 'incredible', 'amazing', 'inspiring',
  'love', 'congratul', 'well done', 'great work', 'great job', 'great move',
  'support', 'admire', 'respect', 'outstanding', 'excellent', 'hero',
  'legend', 'smart', 'fantastic', 'revolutionary', 'pioneer', 'right about',
  'agree with', 'thank you', 'bravo', 'impressed', 'kudos', 'perfect',
  'best thing', 'well said', "couldn't agree", 'spot on', 'absolutely right',
  'totally right', 'exactly right', 'great leader', 'true leader',
];

// Negative-sentiment guard: if the same sentence contains one of these AND a target,
// the positive match is ignored (the post is probably critical).
const NEGATIVE_GUARD = [
  'terrible', 'awful', 'horrible', 'disaster', 'fraud', 'liar', 'lying',
  'corrupt', 'manipulat', 'racist', 'bigot', 'dangerous', 'toxic', 'failure',
  'bankrupt', 'scam', 'hate', 'disgusting', 'unfollow', 'block', 'pathetic',
  'delusional', 'narcissist', 'shame', 'boycott', 'fired', 'layoff',
];

// Rate-limit: ms between unfollow actions.
const UNFOLLOW_DELAY_MS = 2500;
const UNFOLLOW_JITTER_MS = 1000;

// Sentinel attribute so we don't re-process a post.
const PROCESSED_ATTR = 'data-de-elonized';

// In-memory state (also synced to storage so popup can read it).
let enabled = true;
let unfollowedCount = 0;
let unfollowQueue = [];
let queueRunning = false;
const unfollowedAuthors = new Set();

// ─── Initialisation ─────────────────────────────────────────────────────────

browser.storage.local.get(['enabled', 'unfollowedCount']).then(result => {
  enabled = result.enabled !== false; // default on
  unfollowedCount = result.unfollowedCount || 0;
  if (enabled) startObserver();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('enabled' in changes) {
    enabled = changes.enabled.newValue;
    if (!enabled) stopObserver();
    else startObserver();
  }
});

// ─── Detection ──────────────────────────────────────────────────────────────

function shouldUnfollow(postEl) {
  const text = postEl.innerText || '';
  const html = postEl.innerHTML || '';

  // 1. Elon tweet / X post embedded in the post.
  if (/@elonmusk/i.test(html) ||
      /twitter\.com\/elonmusk/i.test(html) ||
      /x\.com\/elonmusk/i.test(html)) {
    return 'elon-embed';
  }

  // 2. Positive-sentiment sentence about a target entity.
  const lower = text.toLowerCase();
  const sentences = lower.split(/(?<=[.!?\n])\s+|[\n]/);
  for (const sentence of sentences) {
    const hasTarget = TARGETS.some(t => sentence.includes(t));
    if (!hasTarget) continue;
    const hasNegative = NEGATIVE_GUARD.some(n => sentence.includes(n));
    if (hasNegative) continue;
    const hasPositive = POSITIVE_WORDS.some(p => sentence.includes(p));
    if (hasPositive) return 'positive-sentiment';
  }

  return null;
}

// ─── Unfollow mechanics ──────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getAuthorFromPost(postEl) {
  const selectors = [
    '.update-components-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name',
    '.update-components-actor__name',
    'a[data-control-name="actor_container"] span[aria-hidden]',
  ];
  for (const sel of selectors) {
    const el = postEl.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return null;
}

async function clickEllipsis(postEl) {
  const selectors = [
    'button[aria-label="Open control menu"]',
    'button[aria-label*="Open control menu"]',
    'button.feed-shared-control-menu__trigger',
    'button[data-control-name="ellipsis"]',
    '.feed-shared-update-v2__control-menu button',
    '.update-v2-social-activity button[aria-label*="menu"]',
  ];
  for (const sel of selectors) {
    const btn = postEl.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  return false;
}

async function clickUnfollowInMenu() {
  await sleep(400);
  const menuSelectors = [
    '[data-control-name="unfollow_member"]',
    '[data-control-name="unfollow_company"]',
  ];
  for (const sel of menuSelectors) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
  }
  // Fallback: scan open menu items by text.
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"]');
  for (const item of menuItems) {
    if (/^unfollow/i.test(item.textContent.trim())) {
      item.click();
      return true;
    }
  }
  // Dismiss the open menu if we couldn't find unfollow.
  document.body.click();
  return false;
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (unfollowQueue.length > 0) {
    const { postEl, reason } = unfollowQueue.shift();
    if (!document.contains(postEl)) continue;

    const author = getAuthorFromPost(postEl);
    if (author && unfollowedAuthors.has(author)) continue;

    const opened = await clickEllipsis(postEl);
    if (!opened) continue;

    const unfollowed = await clickUnfollowInMenu();
    if (unfollowed) {
      unfollowedCount++;
      if (author) unfollowedAuthors.add(author);
      browser.storage.local.set({ unfollowedCount });
      browser.runtime.sendMessage({ type: 'unfollowed', author, reason, count: unfollowedCount });
      console.debug(`[De-Elonizer] Unfollowed "${author}" (${reason})`);
    }

    const delay = UNFOLLOW_DELAY_MS + Math.random() * UNFOLLOW_JITTER_MS;
    await sleep(delay);
  }
  queueRunning = false;
}

function enqueue(postEl, reason) {
  unfollowQueue.push({ postEl, reason });
  processQueue();
}

// ─── Post scanning ───────────────────────────────────────────────────────────

function scanPost(postEl) {
  if (!enabled) return;
  if (postEl.getAttribute(PROCESSED_ATTR)) return;
  postEl.setAttribute(PROCESSED_ATTR, '1');

  const reason = shouldUnfollow(postEl);
  if (reason) enqueue(postEl, reason);
}

function scanAll() {
  const postSelectors = [
    'div.feed-shared-update-v2',
    'li.occludable-update',
    'div[data-id*="urn:li:activity"]',
  ];
  for (const sel of postSelectors) {
    document.querySelectorAll(sel).forEach(scanPost);
  }
}

// ─── MutationObserver ────────────────────────────────────────────────────────

let observer = null;

function isPostNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return node.matches?.('div.feed-shared-update-v2, li.occludable-update') ||
         node.querySelector?.('div.feed-shared-update-v2, li.occludable-update');
}

function startObserver() {
  if (observer) return;
  scanAll();
  observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!isPostNode(node)) continue;
        const posts = node.matches?.('div.feed-shared-update-v2, li.occludable-update')
          ? [node]
          : [...node.querySelectorAll('div.feed-shared-update-v2, li.occludable-update')];
        posts.forEach(scanPost);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  observer?.disconnect();
  observer = null;
}
