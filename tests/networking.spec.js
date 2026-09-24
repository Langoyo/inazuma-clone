import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('multiplayer squad-confirm race', () => {
  test('confirming your squad before a peer connects waits, instead of silently starting a solo match vs AI', async ({ page }) => {
    // Regression test: _confirmSquad used to infer "I'm playing solo" from
    // !net.hasPeer(), but that's also just the normal state of multiplayer
    // before the WebRTC handshake finishes. Whoever clicked Confirm first
    // (likely both players, staring at the same screen) fell into the
    // AI-fallback branch and started an isolated solo match — "we saw
    // different things" from the user's report. The fix reads uiMode
    // instead, which the scene always knows unambiguously.
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    expect(await page.evaluate(() => window.__scene.uiMode)).toBe('multiplayer');
    expect(await page.evaluate(() => window.__scene.net.hasPeer())).toBe(false);

    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);
    await expect(page.locator('#squad-status')).toHaveText('Waiting for opponent…');
  });

  test('once the real peer’s squad is known, the match starts with it — not a generated AI squad', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);

    // Simulate the peer connecting and sending their real squad — exactly
    // the data onSquad's handler (GameScene.js) would receive from
    // network.js once the actual WebRTC handshake completes.
    const opponentStarters = await page.evaluate(() => {
      const s = window.__scene;
      const fakeSquad = { starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [...s.benchIds], formation: s.chosenFormation, color: '#336699' };
      s.remoteSquadPayload = fakeSquad;
      if (s.role === 'A' && s.mySquadConfirmed && !s.matchStarted) s._startMatch(s.mySquadPayload, fakeSquad);
      return fakeSquad.starterIds;
    });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
    const teamBIds = await page.evaluate(() => window.__scene.teamB.map((e) => e.id));
    expect(teamBIds).toEqual(opponentStarters);
  });
});

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
