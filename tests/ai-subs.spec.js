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
