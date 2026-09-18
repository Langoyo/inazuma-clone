// Very simple rule-based AI: chases the ball, defends its goal, and
// shoots when it has the ball near the rival goal. Confrontation choices
// (dribble/tackle, shot/save) are NOT decided here — that's handled by
// aiConfrontationChoice in GameScene, right at the moment of the
// confrontation.
const FIELD_W = 800;
const FIELD_H = 500;

/**
 * @returns {{ target: {x:number,y:number} }}
 */
export function decideAIMove({ selfPos, ballPos, ownGoalX, rivalGoalX }) {
  const attacking = Math.sign(rivalGoalX - ownGoalX);
  const ballIsOnMySide = attacking > 0
    ? ballPos.x < FIELD_W * 0.6
    : ballPos.x > FIELD_W * 0.4;

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.y - selfPos.y);

  if (distToBall < 220 || ballIsOnMySide) {
    return { target: { x: ballPos.x, y: ballPos.y } };
  }

  return {
    target: {
      x: (ballPos.x + ownGoalX) / 2,
      y: clampY(ballPos.y)
    }
  };
}

function clampY(y) {
  return Math.min(Math.max(y, 40), FIELD_H - 40);
}
