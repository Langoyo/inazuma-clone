// Very simple rule-based AI for whichever of the AI team's 11 players is
// currently "active" (closest to the ball — see GameScene). Field is
// vertical: ownGoalY/rivalGoalY are Y coordinates now, not X.
const FIELD_H = 760;

/**
 * @returns {{ target: {x:number,y:number} }}
 */
export function decideAIMove({ selfPos, ballPos, ownGoalY, rivalGoalY }) {
  const attacking = Math.sign(rivalGoalY - ownGoalY);
  const ballIsOnMySide = attacking > 0
    ? ballPos.y < FIELD_H * 0.6
    : ballPos.y > FIELD_H * 0.4;

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.y - selfPos.y);

  if (distToBall < 200 || ballIsOnMySide) {
    return { target: { x: ballPos.x, y: ballPos.y } };
  }

  return {
    target: {
      x: ballPos.x,
      y: (ballPos.y + ownGoalY) / 2
    }
  };
}
