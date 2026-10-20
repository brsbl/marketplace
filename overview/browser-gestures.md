## What you get

- **Back and forward by swipe.** Swipe two fingers right to go back, left to go forward, in any BB desktop browser tab.
- **A Chrome-style arrow.** A dark circle slides in from the edge as you swipe. It turns solid when the swipe is long enough, and navigation happens when you lift your fingers. Pull back before lifting to cancel.
- **Scrolling stays scrolling.** Vertical scrolling is never treated as a gesture. Carousels, code blocks and other horizontal scrollers keep the swipe while they can still move; at their edge, a fresh swipe navigates.
- **Nothing to configure.** No toolbar button or settings; disable the plugin to turn gestures off.

## Limits

- Works in the BB desktop app's browser only, on the top-level page. Cross-origin iframes do not receive the gesture.
- Pages cannot tell when fingers leave the trackpad. If you hold your fingers completely still with the arrow fully out, navigation happens after about 0.6 seconds.
- Built on the experimental browser page API, so a future BB release may need a plugin update.

## Privacy

The plugin reads only scroll movement. It does not read page content, send data anywhere, or need an account.
