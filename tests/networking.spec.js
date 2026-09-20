import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('role assignment vs. a late-connecting peer', () => {
  test('re-derives role once a peer is actually known, but freezes it at kickoff', async ({ page }) => {
    // Regression test: role used to be decided once, synchronously, right
    // when the scene was created — before Trystero's WebRTC handshake had
    // any chance to complete. Two browsers loading the page at the same
    // moment each see "nobody else here yet" and both provisionally became
    // host ('A'), so a real two-player match ran as two independent,
    // disagreeing simulations instead of one host and one client. The fix
    // re-runs the host comparison (_syncRoleFromNet) once a peer is
    // actually known, via net.onPeerConnect.
    await waitForRosterLoaded(page);

    const solo = await page.evaluate(() => window.__scene.role);
    expect(solo).toBe('A'); // alone in the room = provisional host, as before

    const afterLateJoin = await page.evaluate(() => {
      const s = window.__scene;
      // Simulate what onPeerConnect fires after: a peer whose id sorts
      // after ours has now been detected, so the real comparison flips us
      // to 'B' — this is exactly what a stale, never-revisited role missed.
      const original = s.net.isHost;
      s.net.isHost = () => false;
      s._syncRoleFromNet();
      const role = s.role;
      s.net.isHost = original;
      return role;
    });
    expect(afterLateJoin).toBe('B');

    const afterMatchStart = await page.evaluate(() => {
      const s = window.__scene;
      s.matchStarted = true;
      const original = s.net.isHost;
      s.net.isHost = () => true; // even a genuine flip shouldn't apply mid-match
      s._syncRoleFromNet();
      const role = s.role;
      s.net.isHost = original;
      s.matchStarted = false;
      return role;
    });
    expect(afterMatchStart).toBe('B'); // unchanged — role is frozen once kickoff has happened
  });
});
