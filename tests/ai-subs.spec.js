import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('AI substitutions', () => {
  test('subs off its most tired outfield player once below the stamina threshold', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const tired = s.teamB.find((e) => e.slot !== 0);
      const tiredId = tired.id; // snapshot as a plain string — _trySub mutates entry.id in place
      const st = s.statsMapB.get(tiredId);
      st.stamina = st.maxStamina * 0.1; // well under the threshold
      // The AI already ran its own check during the real time that passed
      // since kickoff, arming its interval gate — reset it so this call
      // isn't skipped as "too soon".
      s._aiSubCheckAt = 0;
      s._aiConsiderSub(s.time.now);
      return {
        outStillOnPitch: s.teamB.some((e) => e.id === tiredId),
        benchNowHasOut: s.benchB.includes(tiredId),
        subsUsed: s.aiSubsUsed,
      };
    });

    expect(result.outStillOnPitch).toBe(false);
    expect(result.benchNowHasOut).toBe(true);
    expect(result.subsUsed).toBe(1);
  });

  test('never subs the goalkeeper for fatigue', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const gkStillIn = await page.evaluate(() => {
      const s = window.__scene;
      // Drain everyone's stamina, keeper included — only outfielders
      // should ever be considered as sub candidates.
      s.teamB.forEach((e) => { const st = s.statsMapB.get(e.id); if (st) st.stamina = 1; });
      s._aiConsiderSub(s.time.now);
      return s.teamB.find((e) => e.slot === 0)?.id === s.gkIdB;
    });

    expect(gkStillIn).toBe(true);
  });

  test('respects the interval between checks and the substitution limit', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const candidate = s.teamB.find((e) => e.slot !== 0);
      const st = s.statsMapB.get(candidate.id);
      st.stamina = 1;
      s._aiSubCheckAt = 0; // clear whatever the AI's own live play already armed
      const before = s.aiSubsUsed;
      s._aiConsiderSub(s.time.now); // first check: should sub
      const afterFirst = s.aiSubsUsed;
      // Immediately re-tire the (now different) player in that same slot
      // and check again right away — too soon, should be a no-op.
      const stillOut = s.teamB.find((e) => e.slot !== 0);
      const st2 = s.statsMapB.get(stillOut.id);
      st2.stamina = 1;
      s._aiConsiderSub(s.time.now);
      const afterImmediate = s.aiSubsUsed;

      let now = s.time.now;
      for (let i = 0; i < 6; i++) {
        const c = s.teamB.find((e) => e.slot !== 0);
        const cst = s.statsMapB.get(c.id);
        if (cst) cst.stamina = 1;
        now += 8100; // past AI_SUB_CHECK_MS, so each of these is eligible
        s._aiConsiderSub(now);
      }
      return { before, afterFirst, afterImmediate, final: s.aiSubsUsed };
    });

    expect(result.before).toBe(0);
    expect(result.afterFirst).toBe(1);
    expect(result.afterImmediate).toBe(1); // too soon after the last check — no-op
    expect(result.final).toBeLessThanOrEqual(3);
  });
});

test.describe('on-pitch name follows a lineup change', () => {
  // Regression tests: _trySub/_tryReposition/_syncClientIds all reassign
  // which roster player an entry represents by changing entry.id — stats,
  // PT and possession all key off that id and picked it up immediately,
  // but the on-pitch name is a separate Text object created once at
  // kickoff and was never told to update. The substitute's stats were
  // live the whole time; only the name on the pitch still said whoever
  // used to be there, which read as the substitution having done nothing.

  test('a manual substitution renames the entry on the pitch', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const outEntry = s.teamA.find((e) => e.slot !== 0 && e.body);
      const outId = outEntry.id;
      const before = outEntry.label.text;
      const inId = s.benchA[0];
      s._trySub('A', { outId, inId });
      const inRp = s.rosterAll.find((r) => r.id === inId);
      const entry = s.teamA.find((e) => e.id === inId);
      return { before, after: entry.label.text, expected: inRp.nickname || inRp.name };
    });

    expect(result.after).not.toBe(result.before);
    expect(result.after).toBe(result.expected);
  });

  test('a formation reposition renames both entries involved', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const [eA, eB] = s.teamA.filter((e) => e.slot !== 0 && e.body).slice(0, 2);
      const beforeA = eA.label.text, beforeB = eB.label.text;
      s._tryReposition('A', { aId: eA.id, bId: eB.id });
      const nameA = s.rosterAll.find((r) => r.id === eA.id);
      const nameB = s.rosterAll.find((r) => r.id === eB.id);
      return {
        beforeA, beforeB,
        afterA: eA.label.text, afterB: eB.label.text,
        expectA: nameA.nickname || nameA.name, expectB: nameB.nickname || nameB.name,
      };
    });

    expect(result.afterA).toBe(result.expectA);
    expect(result.afterB).toBe(result.expectB);
    expect(result.afterA).toBe(result.beforeB); // the two genuinely swapped
    expect(result.afterB).toBe(result.beforeA);
  });

  test('a client mirrors a substitution made on the host, name included', async ({ page }) => {
    // _syncClientIds is what a non-hosting peer runs every frame to mirror
    // the host's authoritative lineup — this is the path a real subbed-in
    // player's name takes on the OTHER player's screen in a multiplayer
    // match, not just locally for whoever tapped Confirm on the sub.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const entry = s.teamB.find((e) => e.slot !== 0 && e.body);
      const oldId = entry.id;
      const before = entry.label.text;
      const newId = s.benchB[0];
      s._syncClientIds({ starterIds: { a: s.teamA.map((e) => e.id), b: s.teamB.map((e) => (e.id === oldId ? newId : e.id)) } });
      const rp = s.rosterAll.find((r) => r.id === newId);
      return { before, after: entry.label.text, expected: rp.nickname || rp.name };
    });

    expect(result.after).not.toBe(result.before);
    expect(result.after).toBe(result.expected);
  });
});
