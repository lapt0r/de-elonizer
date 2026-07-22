vibe coded extension to aggressively prune people who post, like, or otherwise engage with Elon content favorably

## How it works

Scans your LinkedIn feed for posts mentioning Elon Musk, Tesla, SpaceX, X, or Grok. Runs AFINN sentiment analysis with domain-tuned overrides to catch hagiography ("genius", "visionary", "undeniable") while ignoring neutral news. On a hit: unfollows the author and hides the post. Also handles promoted posts and "From your activity" recommendations — can't unfollow those, but hides them.

## Requirements

- macOS with Safari
- Xcode (free, from the App Store)
- An Apple ID signed into Xcode (free tier is fine — no paid developer account needed)

## Install

```sh
git clone https://github.com/lapt0r/de-elonizer.git
cd de-elonizer
make install
```

`make install` will generate the Safari extension wrapper, build it, and register it. On first run it also opens the host app — you can close that immediately.

Then in Safari:

1. **Develop → Allow Unsigned Extensions** (you'll need to re-enable this after each Safari restart)
2. **Settings → Extensions → LinkedIn De-Elonizer → enable**
3. Grant access to `linkedin.com` when prompted

## Verify it's working

Open Safari's Web Inspector on a LinkedIn feed tab: **Develop → [your Mac] → linkedin.com**

Reload the page. In the Console you should immediately see:

```
[De-Elonizer] content script loaded vbrowser
[De-Elonizer] observer starting
[De-Elonizer] skip (no target) | "Feed post ..."
```

A line is logged for every post scanned. Hits look like:

```
[De-Elonizer] HIT (score=30 cmp=0.12) +[genius,visionary,...] | "Feed post ..."
[De-Elonizer] Unfollowed "Some Guy" (positive-sentiment)
[De-Elonizer] Hid post by "Some Guy"
```

The popup (click the extension icon) shows a running count of posts successfully pruned from your feed.

If you see `PRUNE ERROR: post by "..." still in DOM after hide`, the hide click didn't take — LinkedIn may have changed their DOM structure. Open an issue with the console output.

## Rebuild after changes

```sh
make install   # rebuild + reinstall
make clean     # wipe generated build artifacts
```
