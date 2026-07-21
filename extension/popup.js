const toggle = document.getElementById('enabledToggle');
const label = document.getElementById('toggleLabel');
const countEl = document.getElementById('count');
const resetBtn = document.getElementById('resetBtn');

browser.storage.local.get(['enabled', 'prunedCount']).then(result => {
  const on = result.enabled !== false;
  toggle.checked = on;
  label.textContent = on ? 'Enabled' : 'Disabled';
  countEl.textContent = result.prunedCount || 0;
});

toggle.addEventListener('change', () => {
  const on = toggle.checked;
  label.textContent = on ? 'Enabled' : 'Disabled';
  browser.storage.local.set({ enabled: on });
});

resetBtn.addEventListener('click', () => {
  browser.storage.local.set({ prunedCount: 0 });
  countEl.textContent = '0';
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'prunedCount' in changes) {
    countEl.textContent = changes.prunedCount.newValue;
  }
});
