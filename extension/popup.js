const toggle = document.getElementById('enabledToggle');
const label = document.getElementById('toggleLabel');
const countEl = document.getElementById('count');
const resetBtn = document.getElementById('resetBtn');

browser.storage.local.get(['enabled', 'unfollowedCount']).then(result => {
  const on = result.enabled !== false;
  toggle.checked = on;
  label.textContent = on ? 'Enabled' : 'Disabled';
  countEl.textContent = result.unfollowedCount || 0;
});

toggle.addEventListener('change', () => {
  const on = toggle.checked;
  label.textContent = on ? 'Enabled' : 'Disabled';
  browser.storage.local.set({ enabled: on });
});

resetBtn.addEventListener('click', () => {
  browser.storage.local.set({ unfollowedCount: 0 });
  countEl.textContent = '0';
});

// Refresh count if a content script unfollowed while the popup is open.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'unfollowedCount' in changes) {
    countEl.textContent = changes.unfollowedCount.newValue;
  }
});
