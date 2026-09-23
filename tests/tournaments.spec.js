import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

// Coverage for offline tournaments (src/data/tournament.js + the
// GameScene wiring around it): the pure bracket/league engine on its own,
// then the actual UI flow — entrant picker, auto-resolving matches that
// don't involve the player, playing your own fixture through the ordinary
// match flow, and the result surviving the page reload _returnToMenu does
// after every match (tournament state lives only in localStorage for
// exactly that reason).

test.describe('pure tournament logic', () => {
  test('a knockout with a non-power-of-two entrant count pads with byes and always completes', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      const outcomes = [];
      for (const n of [2, 3, 5, 6, 7, 9]) {
        const entrants = Array.from({ length: n }, (_, i) => `T${i}`);
        let t = mod.makeKnockout(entrants);
        const strengthOf = () => 100;
        // No entrant here is 'me', so advanceAuto should simulate the
        // whole thing through to a champion without ever returning pending.
        const res = mod.advanceAuto(t, 'me', strengthOf);
        outcomes.push({ n, completed: !!res.tournament.completedAt, pending: res.pending, champion: res.tournament.champion, isEntrant: entrants.includes(res.tournament.champion) });
      }
      return outcomes;
    });
    for (const o of result) {
      expect(o.completed, `n=${o.n}`).toBe(true);
      expect(o.pending, `n=${o.n}`).toBeNull();
      expect(o.isEntrant, `n=${o.n} champion should be one of the entrants`).toBe(true);
    }
  });

  test('league standings are computed correctly from recorded results', async ({ page }) => {
    await page.goto('/');
    const standings = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      let t = mod.makeLeague(['me', 'A', 'B']);
      // Force a known fixture order by finding each pair explicitly rather
      // than relying on the (shuffled) generated order.
      const idx = (a, b) => t.fixtures.findIndex((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
      const record = (a, b, sa, sb) => {
        const fi = idx(a, b);
        const f = t.fixtures[fi];
        t = mod.recordLeagueResult(t, fi, f.a === a ? sa : sb, f.a === a ? sb : sa);
      };
      record('me', 'A', 2, 0); // me beats A
      record('me', 'B', 1, 1); // me draws B
      record('A', 'B', 3, 0); // A beats B
      return mod.leagueStandings(t);
    });
    const byId = Object.fromEntries(standings.map((r) => [r.id, r]));
    // me: W1 D1, 4 points, gd +2
    expect(byId.me.points).toBe(4);
    expect(byId.me.won).toBe(1);
    expect(byId.me.drawn).toBe(1);
    expect(byId.me.gd).toBe(2);
    // A: W1 L1, 3 points
    expect(byId.A.points).toBe(3);
    // B: L1 D1, 1 point
    expect(byId.B.points).toBe(1);
    // sorted by points desc: me (4), A (3), B (1)
    expect(standings.map((r) => r.id)).toEqual(['me', 'A', 'B']);
  });

  test('simulateResult trends toward the stronger side on average', async ({ page }) => {
    await page.goto('/');
    const avg = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      let totalStrong = 0, totalWeak = 0;
      const N = 1500;
      for (let i = 0; i < N; i++) {
        const { scoreA, scoreB } = mod.simulateResult(112, 95);
        totalStrong += scoreA; totalWeak += scoreB;
      }
      return { strong: totalStrong / N, weak: totalWeak / N };
    });
    expect(avg.strong).toBeGreaterThan(avg.weak);
  });
});

test.describe('tournament UI', () => {
  test('the pool of possible opponents only includes teams that can actually field a full XI', async ({ page }) => {
    await waitForRosterLoaded(page);
    const check = await page.evaluate(() => {
      const s = window.__scene;
      const options = s._teamEraOptions();
      const tooSmall = options.filter((o) => s._entrantPool(o.value).length < 11);
      return { count: options.length, tooSmall: tooSmall.length };
    });
    expect(check.count).toBeGreaterThan(50);
    expect(check.tooSmall).toBe(0);
  });

  test('starting a tournament without a complete squad shows an error and creates nothing', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#tournament-view-btn');
    await page.click('[data-tournament-action="start"]');
    await expect(page.locator('#tournament-start-error')).toContainText('0/11');
    expect(await page.evaluate(() => window.__scene.activeTournament)).toBeNull();
  });

  test('picking a size draws exactly that many teams, and your squad locks in at start', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    const squadBefore = await page.evaluate(() => ({ starterIds: [...window.__scene.squadSlots], formation: window.__scene.chosenFormation }));
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-size"][value="8"]');
    await page.click('[data-tournament-action="start"]');

    const t = await page.evaluate(() => window.__scene.activeTournament);
    expect(t.entrants.length).toBe(8);
    expect(t.entrants[0]).toBe('me');
    expect(new Set(t.entrants).size).toBe(8); // no duplicate opponents
    expect(t.mySquad.starterIds).toEqual(squadBefore.starterIds);
    expect(t.mySquad.formation).toBe(squadBefore.formation);
    await expect(page.locator('#tournament-body')).toContainText('locked for this tournament');
  });

  test('starting a knockout auto-resolves matches that do not involve you, leaving your own fixture up next', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-size"][value="4"]');
    await page.click('[data-tournament-action="start"]');

    const playBtn = page.locator('[data-tournament-action="play"]');
    await expect(playBtn).toBeVisible();
    expect(await playBtn.textContent()).toContain('You vs');

    // The other first-round match (the one without 'me') should already
    // carry a recorded score — it was simulated, not left pending.
    const otherMatchPlayed = await page.evaluate(() => {
      const t = window.__scene.activeTournament;
      const other = t.rounds[0].find((m) => m.a !== 'me' && m.b !== 'me');
      return other.scoreA != null && other.scoreB != null;
    });
    expect(otherMatchPlayed).toBe(true);
  });

  test('playing your fixture starts the match immediately with the locked squad and the opponent’s real roster — no Formation detour', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    const lockedStarters = await page.evaluate(() => [...window.__scene.squadSlots]);
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-size"][value="4"]');
    await page.click('[data-tournament-action="start"]');
    await page.click('[data-tournament-action="play"]');

    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      pending: window.__scene._tournamentPendingFixture,
      teamACount: window.__scene.teamA.length,
      teamBCount: window.__scene.teamB.length,
      teamAIds: window.__scene.teamA.map((e) => e.id),
    }));
    expect(state.pending).not.toBeNull();
    expect(state.teamACount).toBe(11);
    expect(state.teamBCount).toBe(11);
    expect(state.teamAIds).toEqual(lockedStarters);
    // The tournament panel should already be out of the way, not left
    // covering the match that just started.
    await expect(page.locator('#tournament-panel')).toBeHidden();
  });

  test('changing your squad after locking it in does not affect the tournament — the same locked XI is used for the next fixture too', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    const lockedStarters = await page.evaluate(() => [...window.__scene.squadSlots]);
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-size"][value="8"]'); // more rounds to reach
    await page.click('[data-tournament-action="start"]');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });

    // Win the first fixture, then go build a totally different squad before
    // playing the next one.
    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '5-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    await page.click('#mode-solo-btn');
    await page.click('#randomize-squad-btn'); // a fresh, near-certainly different XI

    await page.click('#tournament-view-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    const teamAIds = await page.evaluate(() => window.__scene.teamA.map((e) => e.id));
    expect(teamAIds).toEqual(lockedStarters);
  });

  test('finishing your match records the result, advances the bracket, and survives a reload', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-size"][value="4"]');
    await page.click('[data-tournament-action="start"]');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });

    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '2-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:tournament:v1')));
    const myMatch = stored.rounds[0].find((m) => m.a === 'me' || m.b === 'me');
    expect(myMatch.winner).toBe('me');
    expect(myMatch.scoreA).not.toBeNull();
    expect(stored.mySquad).toBeTruthy();

    // A real reload is what actually happens after full time in the game
    // (_returnToMenu) — confirm the tournament isn't just in-memory state
    // that would vanish the moment that happens.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    const afterReload = await page.evaluate(() => window.__scene.activeTournament);
    const myMatchAfter = afterReload.rounds[0].find((m) => m.a === 'me' || m.b === 'me');
    expect(myMatchAfter.winner).toBe('me');
    expect(afterReload.mySquad).toBeTruthy();
  });

  test('abandoning a tournament clears it and returns to the setup form', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.click('#tournament-view-btn');
    await page.click('[data-tournament-action="start"]');
    await expect(page.locator('[data-tournament-action="end"]')).toBeVisible();

    await page.click('[data-tournament-action="end"]');
    await expect(page.locator('input[name="tournament-type"]')).toHaveCount(2);
    const stored = await page.evaluate(() => localStorage.getItem('inazuma-clone:tournament:v1'));
    expect(stored).toBeNull();
  });

  test('a league draws a standings table with a ranked row per entrant', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#randomize-top-btn');
    await page.click('#tournament-view-btn');
    await page.check('input[name="tournament-type"][value="league"]');
    await page.check('input[name="tournament-size"][value="4"]');
    await page.click('[data-tournament-action="start"]');

    const table = page.locator('#tournament-body table.nes-table');
    await expect(table).toBeVisible();
    const rowCount = await table.locator('tbody tr').count();
    expect(rowCount).toBe(4); // me + 3 random opponents
    await expect(table).toContainText('You');
    // Ranked with a position column, not just a bare list.
    const firstCell = await table.locator('tbody tr').first().locator('td').first().textContent();
    expect(firstCell.trim()).toBe('1');
  });
});
