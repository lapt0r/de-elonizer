// Target entities — post must mention at least one to be considered.
const TARGETS = [
  'elon', 'musk', '@elonmusk', '#elonmusk', 'tesla', 'spacex',
  'twitter/x', 'x.com', 'xai', 'x ai', 'grok',
];

// Domain-adapted AFINN overrides.
// Two categories:
//   1. Adversity words that appear in hagiography with positive framing
//      ("he stared failure in the face") → neutralised to 0.
//   2. Elon-worship vocabulary not in AFINN-165 → boosted.
const SENTIMENT_EXTRAS = {
  // neutralise adversity words used admiringly
  failure: 0, failures: 0, beaten: 0, bankrupt: 0, bankruptcy: 0,
  exploding: 0, folded: 0, critics: 0, criticism: 0,
  bullied: 0, condemned: 0, condemnation: 0, adversity: 0, struggled: 0,
  // boost worship vocabulary missing from AFINN
  visionary: 5, genius: 5, audacious: 4, undeniable: 3,
  multiplanetary: 3, pioneer: 4, revolutionary: 4,
  resilience: 3, resilient: 3, grit: 3, tenacity: 3,
  unstoppable: 4, relentless: 3, insightful: 3,
  'self-awareness': 3, discipline: 2, rebuilding: 2,
};

// Minimum thresholds: absolute score AND comparative (score/wordcount).
// Calibrated so hagiography (≥0.15) passes while neutral news (<0.1) doesn't.
const SCORE_MIN = 3;
const COMPARATIVE_MIN = 0.1;

// Initialise sentiment analyser once (expensive-ish constructor).
// `Sentiment` is the UMD global exposed by lib/sentiment.min.js.
const _sentiment = new Sentiment(); // eslint-disable-line no-undef

// Rate-limit: ms between unfollow actions.
const UNFOLLOW_DELAY_MS = 2500;
const UNFOLLOW_JITTER_MS = 1000;

// Sentinel attribute so we don't re-process a post.
const PROCESSED_ATTR = 'data-de-elonized';

let enabled = true;
let unfollowedCount = 0;
let unfollowQueue = [];
let queueRunning = false;
const unfollowedAuthors = new Set();

// ─── Initialisation ─────────────────────────────────────────────────────────

browser.storage.local.get(['enabled', 'unfollowedCount']).then(result => {
  enabled = result.enabled !== false;
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
  const lower = text.toLowerCase();

  // 1. Elon tweet / X post embedded in the post.
  if (/@elonmusk/i.test(html) ||
      /twitter\.com\/elonmusk/i.test(html) ||
      /x\.com\/elonmusk/i.test(html)) {
    return 'elon-embed';
  }

  // 2. Post must mention at least one target entity.
  if (!TARGETS.some(t => lower.includes(t))) return null;

  // 3. Run AFINN sentiment with domain overrides.
  const result = _sentiment.analyze(text, { extras: SENTIMENT_EXTRAS });
  if (result.score >= SCORE_MIN && result.comparative >= COMPARATIVE_MIN) {
    return 'positive-sentiment';
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
    '.update-components-actor__name',
    '.feed-shared-actor__name',
    'a[data-control-name="actor_container"] span[aria-hidden]',
    '[data-view-name="profile-card"] span[aria-hidden="true"]',
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
    'button[aria-label*="options"]',
    'button[aria-haspopup="true"][aria-label*="more"]',
  ];
  for (const sel of selectors) {
    const btn = postEl.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  return false;
}

async function clickUnfollowInMenu() {
  await sleep(500);
  const menuSelectors = [
    '[data-control-name="unfollow_member"]',
    '[data-control-name="unfollow_company"]',
    '[data-control-name="unfollow"]',
  ];
  for (const sel of menuSelectors) {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
  }
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], li button');
  for (const item of menuItems) {
    if (/^unfollow/i.test(item.textContent.trim())) {
      item.click();
      return true;
    }
  }
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
    if (!opened) {
      console.debug('[De-Elonizer] Could not find ellipsis button in post');
      continue;
    }

    const unfollowed = await clickUnfollowInMenu();
    if (unfollowed) {
      unfollowedCount++;
      if (author) unfollowedAuthors.add(author);
      browser.storage.local.set({ unfollowedCount });
      browser.runtime.sendMessage({ type: 'unfollowed', author, reason, count: unfollowedCount });
      console.debug(`[De-Elonizer] Unfollowed "${author}" (${reason})`);
    } else {
      console.debug(`[De-Elonizer] Unfollow menu item not found for "${author}"`);
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
  if (reason) {
    console.debug(`[De-Elonizer] Detected post (${reason}), queueing unfollow`);
    enqueue(postEl, reason);
  }
}

const POST_SELECTORS = [
  'div.feed-shared-update-v2',
  'li.occludable-update',
  'div[data-urn*="urn:li:activity"]',
  'div[data-id*="urn:li:activity"]',
];
const POST_SELECTOR_STRING = POST_SELECTORS.join(', ');

function scanAll() {
  document.querySelectorAll(POST_SELECTOR_STRING).forEach(scanPost);
}

// ─── MutationObserver ────────────────────────────────────────────────────────

let observer = null;

function extractPosts(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  if (node.matches?.(POST_SELECTOR_STRING)) return [node];
  return [...(node.querySelectorAll?.(POST_SELECTOR_STRING) ?? [])];
}

function startObserver() {
  if (observer) return;
  scanAll();
  observer = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        extractPosts(node).forEach(scanPost);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  observer?.disconnect();
  observer = null;
}
