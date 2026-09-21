import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch, findOnScreenPlayer } from './helpers.js';

test.describe('drawing a path', () => {
  test('a real drag produces a multi-point path that persists', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    const player = await findOnScreenPlayer(page);
    expect(player).not.toBeNull();

    await page.mouse.move(player.screenX, player.screenY);
    await page.mouse.down();
    await page.mouse.move(player.screenX + 60, player.screenY - 250, { steps: 20 });

    // Whose path this is comes from the scene, not the player sampled above:
    // play is live, so between reading that position and the mouse actually
    // landing on it they may have run out of PLAYER_SEL_RADIUS, handing the
    // drag to a teammate nearer the press (or to the active player). Which
    // one it is was never the point — that a real drag builds a path that
    // then survives is.
    const mid = await page.evaluate(() => {
      const s = window.__scene;
      return {
        selectedId: s.selectedPlayerId,
        onMyTeam: (s.role === 'A' ? s.teamA : s.teamB).some((e) => e.id === s.selectedPlayerId),
        pathLen: s.myPaths.get(s.selectedPlayerId)?.length ?? null,
        gestureMoved: s.gestureMoved,
      };
    });
    expect(mid.gestureMoved).toBe(true);
    expect(mid.onMyTeam).toBe(true);
    expect(mid.pathLen).toBeGreaterThan(1);

    await page.waitForTimeout(600); // still holding — should not be consumed away
    const held = await page.evaluate(
      (id) => window.__scene.myPaths.get(id)?.length ?? null,
      mid.selectedId
    );
    expect(held).not.toBeNull();

    await page.mouse.up();
  });

  test('a fresh drag mid-run is not silently swapped for the auto-continue dot', async ({ page }) => {
    // Regression test for the race in _computeTargets: a short, fast drag
    // that starts right where the player already is (a quick flick
    // continuing the run they were already on) could add a waypoint that
    // gets consumed the very same tick it landed. Since the player still
    // has the ball, that used to hand them straight to the auto-continue
    // "keep running" marker — silently replacing the real line with just a
    // dot while the drag was still in progress. See GameScene.js
    // _computeTargets for the fix and full writeup.
    await waitForRosterLoaded(page);
    await startMatch(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const e = s.teamA.find((x) => x.slot !== 0);
      s.currentPossession = 'A';
      s.possRole = 'A';
      s.confrontation = null;
      s._setActive('A', e.id);
      const pos = { x: e.body.position.x, y: e.body.position.y };
      const cam = s.cameras.main;
      const toScreen = (wx, wy) => ({ x: wx - cam.scrollX, y: wy - cam.scrollY });

      // Simulate "just finished a drawn line, still carrying the ball":
      // a lone waypoint right next to the player.
      s.myPaths.set(e.id, [{ x: pos.x + 5, y: pos.y + 5 }]);
      s._computeTargets();
      const gotAutoFlagged = s.autoPathIds.has(e.id);

      // Now the user starts a fresh, short "forward" drag on the same
      // player — the exact reported scenario.
      s.drawing = true;
      s.gestureStart = { x: pos.x, y: pos.y, sx: 0, sy: 0 };
      s.gestureMoved = false;
      s.pendingSelectedPlayerId = e.id;
      const scr = toScreen(pos.x + 15, pos.y); // 15 world units, inside WAYPOINT_RADIUS (20)
      s._pointerMove({ x: scr.x, y: scr.y, isDown: true });
      const clearedOnDragStart = !s.autoPathIds.has(e.id);

      // A tick fires while the drag is still in progress — this is where
      // the race used to fire.
      s._computeTargets();
      const stillNotAutoMidDrag = !s.autoPathIds.has(e.id);
      const pathLenMidDrag = s.myPaths.get(e.id)?.length;

      // Several more ticks, still dragging, no new input — should keep
      // holding rather than upgrading.
      for (let i = 0; i < 5; i++) s._computeTargets();
      const stillNotAutoAfterMoreTicks = !s.autoPathIds.has(e.id);

      // Release, then confirm auto-continue still works normally for the
      // ordinary (not-mid-drag) case — no regression to the real feature.
      s.drawing = false;
      s.myPaths.set(e.id, [{ x: pos.x + 3, y: pos.y + 3 }]);
      s._computeTargets();
      const autoStillWorksAfterRelease = s.autoPathIds.has(e.id);

      return {
        gotAutoFlagged,
        clearedOnDragStart,
        stillNotAutoMidDrag,
        pathLenMidDrag,
        stillNotAutoAfterMoreTicks,
        autoStillWorksAfterRelease,
      };
    });

    expect(result.gotAutoFlagged).toBe(true); // baseline reproduces
    expect(result.clearedOnDragStart).toBe(true);
    expect(result.pathLenMidDrag).toBe(0); // both points did get consumed
    expect(result.stillNotAutoMidDrag).toBe(true); // ...but the fix held anyway
    expect(result.stillNotAutoAfterMoreTicks).toBe(true);
    expect(result.autoStillWorksAfterRelease).toBe(true); // real feature intact
  });
});

test.describe('tap to pass', () => {
  test('leaves a fading blue marker at the tapped spot', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    // The match keeps running underneath us — a duel can start on its own
    // between when we clear `confrontation` and when the tap actually
    // lands, which would silently swallow the tap (see _pointerUp's
    // `!this.confrontation` guard). Retry a few times rather than assume
    // a single attempt always lands clean.
    let marker = null;
    for (let attempt = 0; attempt < 5 && !marker; attempt++) {
      await page.evaluate(() => {
        const s = window.__scene;
        s.confrontation = null;
        s.currentPossession = 'A';
        s.possRole = 'A';
      });
      await page.mouse.move(200, 400);
      await page.mouse.down();
      await page.mouse.up(); // a plain tap, no movement
      try {
        const handle = await page.waitForFunction(() => {
          const s = window.__scene;
          if (!s.passMarker) return false;
          return { x: s.passMarker.x, y: s.passMarker.y, until: s.passMarker.until, now: s.time.now };
        }, { timeout: 300 });
        marker = await handle.jsonValue();
      } catch {
        // no marker within the window — a duel likely stole this attempt.
      }
    }
    expect(marker).not.toBeNull();
    expect(Number.isFinite(marker.x)).toBe(true);
    expect(Number.isFinite(marker.y)).toBe(true);
    expect(marker.until).toBeGreaterThan(marker.now);

    // It fades and clears itself once its lifetime is up. Force the expiry
    // and redraw in one round-trip — the marker's real 400ms lifetime means
    // a separate evaluate() for each step risks it already having expired
    // (and been cleared) naturally by the time the second one runs.
    await page.evaluate(() => {
      const s = window.__scene;
      if (s.passMarker) s.passMarker.until = s.time.now - 1;
      s._drawPaths();
    });
    expect(await page.evaluate(() => window.__scene.passMarker)).toBeNull();
  });
});

test.describe('on-screen camera pad', () => {
  /** The pad's own bounding box, which its grid cells are laid out inside. */
  const padBox = (page) => page.evaluate(() => {
    const r = document.getElementById('wasd-pad').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  test('its empty corner cells let a press through to the pitch behind', async ({ page }) => {
    // Regression test: the d-pad's grid leaves two cells empty (either side
    // of W), and its wrapper is a bare layout box around the whole thing.
    // Both are transparent — they read as pitch — but both still covered
    // those points, so a press there never reached the canvas at all: a
    // player standing in that corner couldn't be grabbed to draw a run,
    // with nothing on screen to explain why.
    await waitForRosterLoaded(page);
    await startMatch(page);
    const box = await padBox(page);

    const hitAt = (x, y) => page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el && el.tagName;
    }, { x, y });

    expect(await hitAt(box.x + 14, box.y + 14)).toBe('CANVAS');
    expect(await hitAt(box.x + box.w - 14, box.y + 14)).toBe('CANVAS');
    // The buttons themselves must still take their own presses, though.
    expect(await hitAt(box.x + box.w / 2, box.y + 14)).toBe('BUTTON');
    expect(await hitAt(box.x + box.w / 2, box.y + box.h - 14)).toBe('BUTTON');
  });

  test('holding a button still scrolls the camera, and releasing it stops', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const box = await padBox(page);

    const before = await page.evaluate(() => window.__scene.cameras.main.scrollY);
    await page.mouse.move(box.x + box.w / 2, box.y + box.h - 14); // S
    await page.mouse.down();
    expect(await page.evaluate(() => window.__scene.scrollKeys.down)).toBe(true);
    await page.waitForTimeout(400);
    await page.mouse.up();

    expect(await page.evaluate(() => window.__scene.scrollKeys.down)).toBe(false);
    const after = await page.evaluate(() => window.__scene.cameras.main.scrollY);
    expect(after).toBeGreaterThan(before);
  });
});
