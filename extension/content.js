console.log('[De-Elonizer] content script loaded v' + (typeof browser !== 'undefined' ? 'browser' : 'chrome'));

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
let prunedCount = 0;
let unfollowQueue = [];
let queueRunning = false;
const unfollowedAuthors = new Set();
let instantTriggers = [];

// ─── Initialisation ─────────────────────────────────────────────────────────

// Load local config (untracked, personal). Absent file = no instant triggers.
fetch(browser.runtime.getURL('config.local.json'))
  .then(r => r.json())
  .then(cfg => {
    instantTriggers = cfg.instantTriggers || [];
    if (instantTriggers.length)
      console.log(`[De-Elonizer] instant triggers loaded: ${instantTriggers.join(' ')}`);
  })
  .catch(() => {});

browser.storage.local.get(['enabled', 'prunedCount']).then(result => {
  enabled = result.enabled !== false;
  prunedCount = result.prunedCount || 0;
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
  const text = postEl.innerText
    || [...postEl.querySelectorAll('p span, p')].map(el => el.textContent).join(' ')
    || '';
  const lower = text.toLowerCase();
  const snippet = text.slice(0, 80).replace(/\s+/g, ' ').trim();

  // 0. Instant triggers from config.local.json — bypass sentiment entirely.
  if (instantTriggers.length && instantTriggers.some(t => text.includes(t))) {
    console.log(`[De-Elonizer] HIT (instant-trigger) | "${snippet}…"`);
    return 'instant-trigger';
  }

  // 1. Elon tweet / X post embedded — check link hrefs instead of innerHTML.
  const hasElonLink = [...postEl.querySelectorAll('a[href]')].some(a => {
    const href = a.getAttribute('href') || '';
    return /elonmusk/i.test(href);
  });
  if (hasElonLink || /@elonmusk/i.test(text)) {
    console.log(`[De-Elonizer] HIT (elon-embed) | "${snippet}…"`);
    return 'elon-embed';
  }

  // 2. Post must mention at least one target entity.
  if (!TARGETS.some(t => lower.includes(t))) {
    console.debug(`[De-Elonizer] skip (no target) | "${snippet}…"`);
    return null;
  }

  // 3. Run AFINN sentiment with domain overrides.
  const result = _sentiment.analyze(text, { extras: SENTIMENT_EXTRAS });
  const { score, comparative, positive, negative } = result;

  if (score >= SCORE_MIN && comparative >= COMPARATIVE_MIN) {
    console.log(
      `[De-Elonizer] HIT (score=${score} cmp=${comparative.toFixed(2)}) +[${positive}] -[${negative}] | "${snippet}…"`
    );
    return 'positive-sentiment';
  }

  console.log(
    `[De-Elonizer] skip (score=${score} cmp=${comparative.toFixed(2)}) +[${positive}] -[${negative}] | "${snippet}…"`
  );
  return null;
}

// ─── Unfollow mechanics ──────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getAuthorFromPost(postEl) {
  // Extract from aria-label: "Open control menu for post by <Name>"
  const controlBtn = postEl.querySelector('button[aria-label^="Open control menu for post by "]');
  if (controlBtn) {
    const m = controlBtn.getAttribute('aria-label').match(/^Open control menu for post by (.+)$/);
    if (m) return m[1];
  }
  // Legacy class-based selectors
  for (const sel of [
    '.update-components-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.feed-shared-actor__name',
  ]) {
    const el = postEl.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return null;
}

async function clickEllipsis(postEl) {
  for (const sel of [
    'button[aria-label^="Open control menu for post"]',
    'button[aria-label*="Open control menu"]',
    'button.feed-shared-control-menu__trigger',
    'button[data-control-name="ellipsis"]',
    'button[aria-label*="options"]',
    'button[aria-haspopup="true"][aria-label*="more"]',
  ]) {
    const btn = postEl.querySelector(sel);
    if (btn) { btn.click(); return true; }
  }
  return false;
}

async function clickMenuItemByControlName(controlNames, textPatterns) {
  await sleep(500);
  for (const name of controlNames) {
    const el = document.querySelector(`[data-control-name="${name}"]`);
    if (el) { el.click(); return true; }
  }
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], li button');
  for (const item of menuItems) {
    const text = item.textContent.trim();
    if (textPatterns.some(p => p.test(text))) {
      item.click();
      return true;
    }
  }
  document.body.click();
  return false;
}

async function clickUnfollowInMenu() {
  return clickMenuItemByControlName(
    ['unfollow_member', 'unfollow_company', 'unfollow'],
    [/^unfollow/i]
  );
}

async function clickRemoveConnectionInMenu() {
  return clickMenuItemByControlName(
    ['remove_connection', 'disconnect'],
    [/^remove connection/i, /^disconnect/i, /^remove from/i]
  );
}

function isPromotedPost(postEl) {
  return (postEl.id || '').startsWith('feedControlMenu') ||
         !!postEl.querySelector('button[aria-label^="Hide ad"]');
}

function isRecommendedPost(postEl) {
  // "From your activity" / "Recommended" cards — no follow relationship, skip unfollow
  const text = postEl.innerText || '';
  return /from your activity/i.test(text) || /recommended for you/i.test(text);
}

async function clickHidePost(postEl) {
  // Ads: button form
  const adBtn = postEl.querySelector('button[aria-label^="Hide ad"]');
  if (adBtn) { adBtn.click(); return true; }
  // Ads: clickable <p> inside feedControlMenu (LinkedIn renders these as text nodes)
  if (isPromotedPost(postEl)) {
    for (const p of postEl.querySelectorAll('p')) {
      if (/hide\s+ad/i.test(p.textContent)) { p.click(); return true; }
    }
  }
  // Organic: direct button
  const postBtn = postEl.querySelector('button[aria-label^="Hide post"]');
  if (postBtn) { postBtn.click(); return true; }
  // Fallback: open menu
  const opened = await clickEllipsis(postEl);
  if (!opened) return false;
  return clickMenuItemByControlName(
    ['not_interested', 'hide_post', 'not_interested_post'],
    [/not interested/i, /don't want to see/i, /^hide this post/i, /^hide post/i, /^hide ad/i]
  );
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (unfollowQueue.length > 0) {
    const { ref, reason } = unfollowQueue.shift();
    const postEl = ref.deref();
    if (!postEl || !document.contains(postEl)) continue;

    const author = getAuthorFromPost(postEl);
    const promoted = isPromotedPost(postEl);
    const alreadyUnfollowed = author && unfollowedAuthors.has(author);

    const recommended = isRecommendedPost(postEl);

    // Step 1: Unfollow / remove connection.
    // instant-trigger → remove connection (nuclear); ads/recommended → skip;
    // normal hits → unfollow.
    if (promoted) {
      console.log(`[De-Elonizer] Promoted post — skipping unfollow, hiding ad`);
    } else if (recommended) {
      console.log(`[De-Elonizer] Recommended post — skipping unfollow, hiding`);
    } else if (!alreadyUnfollowed) {
      const opened = await clickEllipsis(postEl);
      if (!opened) {
        console.log('[De-Elonizer] Could not find ellipsis button');
      } else {
        if (reason === 'instant-trigger') {
          const removed = await clickRemoveConnectionInMenu();
          if (removed) {
            if (author) unfollowedAuthors.add(author);
            console.log(`[De-Elonizer] Removed connection "${author}" (instant-trigger)`);
          } else {
            // Fall back to unfollow if not a 1st-degree connection.
            const unfollowed = await clickUnfollowInMenu();
            if (unfollowed) {
              if (author) unfollowedAuthors.add(author);
              console.log(`[De-Elonizer] Unfollowed "${author}" (instant-trigger, not connected)`);
            } else {
              console.log(`[De-Elonizer] Could not remove/unfollow "${author}"`);
            }
          }
        } else {
          const unfollowed = await clickUnfollowInMenu();
          if (unfollowed) {
            if (author) unfollowedAuthors.add(author);
            console.log(`[De-Elonizer] Unfollowed "${author}" (${reason})`);
          } else {
            console.log(`[De-Elonizer] Unfollow menu item not found for "${author}"`);
          }
        }
        await sleep(400);
      }
    }

    // Step 2: Hide the post. Count and verify removal on success.
    if (document.contains(postEl)) {
      const hidden = await clickHidePost(postEl);
      if (hidden) {
        console.log(`[De-Elonizer] Hid post by "${author}"`);
        // Verify the post actually leaves the DOM within 1.5s.
        await sleep(1500);
        if (document.contains(postEl)) {
          console.log(`[De-Elonizer] PRUNE ERROR: post by "${author}" still in DOM after hide`);
        } else {
          prunedCount++;
          browser.storage.local.set({ prunedCount });
          browser.runtime.sendMessage({ type: 'pruned', author, reason, count: prunedCount });
        }
      } else {
        console.log(`[De-Elonizer] Could not hide post by "${author}"`);
      }
    }

    const delay = UNFOLLOW_DELAY_MS + Math.random() * UNFOLLOW_JITTER_MS;
    await sleep(delay);
  }
  queueRunning = false;
}

function enqueue(postEl, reason) {
  // WeakRef lets GC collect virtualized posts LinkedIn removes from DOM.
  unfollowQueue.push({ ref: new WeakRef(postEl), reason });
  processQueue();
}

// ─── Post scanning ───────────────────────────────────────────────────────────

function scanPost(postEl) {
  if (!enabled) return;
  if (postEl.getAttribute(PROCESSED_ATTR)) return;
  postEl.setAttribute(PROCESSED_ATTR, '1');

  const reason = shouldUnfollow(postEl);
  if (reason) {
    console.log(`[De-Elonizer] Detected post (${reason}), queueing unfollow`);
    enqueue(postEl, reason);
  }
}

const POST_SELECTORS = [
  '[id^="expanded"][id*="FeedType_"]',          // organic posts
  '[id^="feedControlMenu"][id*="FeedType_"]',   // promoted posts
  'div.feed-shared-update-v2',                  // legacy
  'li.occludable-update',                       // legacy
  'div[data-urn*="urn:li:activity"]',
  'div[data-id*="urn:li:activity"]',
];
const POST_SELECTOR_STRING = POST_SELECTORS.join(', ');

function scanAll() {
  document.querySelectorAll(POST_SELECTOR_STRING).forEach(scanPost);
}

// ─── MutationObserver ────────────────────────────────────────────────────────

let observer = null;
let mutationBuffer = [];
let flushTimer = null;

function extractPosts(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  if (node.matches?.(POST_SELECTOR_STRING)) return [node];
  return [...(node.querySelectorAll?.(POST_SELECTOR_STRING) ?? [])];
}

function flushMutations() {
  flushTimer = null;
  const nodes = mutationBuffer;
  mutationBuffer = [];
  for (const node of nodes) extractPosts(node).forEach(scanPost);
}

function startObserver() {
  if (observer) return;
  console.log('[De-Elonizer] observer starting');
  scanAll();
  observer = new MutationObserver(mutations => {
    for (const mut of mutations)
      for (const node of mut.addedNodes)
        mutationBuffer.push(node);
    // Debounce: process burst of mutations in one batch after 300ms idle.
    if (!flushTimer) flushTimer = setTimeout(flushMutations, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  observer?.disconnect();
  observer = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  mutationBuffer = [];
}

// Pause entirely when tab is backgrounded — LinkedIn still mutates the DOM.
document.addEventListener('visibilitychange', () => {
  if (!enabled) return;
  if (document.hidden) stopObserver();
  else startObserver();
});

// ─── Memory pressure logging ─────────────────────────────────────────────────

const MEMORY_STEP = 500 * 1024;
let lastMemoryThreshold = 0;

async function checkMemoryPressure() {
  let bytes = 0;
  try {
    // Preferred: cross-agent memory API (Safari 15+, requires isolation)
    bytes = (await performance.measureUserAgentSpecificMemory()).bytes;
  } catch (_) {
    // Fallback: Chrome non-standard property
    bytes = window.performance?.memory?.usedJSHeapSize || 0;
  }
  if (!bytes) return;
  const threshold = Math.floor(bytes / MEMORY_STEP) * MEMORY_STEP;
  if (threshold > lastMemoryThreshold) {
    lastMemoryThreshold = threshold;
    console.log(`[De-Elonizer] memory pressure: ~${Math.round(bytes / 1024)}KB (crossed ${threshold / 1024}KB mark)`);
  }
}

setInterval(checkMemoryPressure, 30_000);
