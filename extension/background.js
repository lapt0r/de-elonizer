browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'unfollowed') {
    console.log(`[De-Elonizer] Unfollowed "${msg.author}" — reason: ${msg.reason}. Total: ${msg.count}`);
  }
});
