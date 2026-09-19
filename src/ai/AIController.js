// Very simple rule-based AI for whichever of the AI team's 11 players is
// currently "active" (closest to the ball — see GameScene). Written to be
// orientation-agnostic: the caller says which axis is the attacking axis
// ('x' for a horizontal field, 'y' for a vertical one) and where each
// goal sits along it.
export function decideAIMove({ selfPos, ballPos, axis, ownGoalValue, rivalGoalValue, fieldPrimarySize, hasBall, goalCentre }) {
  // Carrying the ball: drive at the goal. Aiming at the ball instead (which
  // is glued just in front of whoever holds it) means chasing your own feet,
  // which had the AI circling the box instead of attacking it.
  if (hasBall) {
    const secondary = axis === 'y' ? 'x' : 'y';
    const target = { x: selfPos.x, y: selfPos.y };
    target[axis] = rivalGoalValue;
    if (goalCentre != null) target[secondary] = goalCentre;
    return { target };
  }

  const attacking = Math.sign(rivalGoalValue - ownGoalValue);
  const ballPrimary = ballPos[axis];
  const ballIsOnMySide = attacking > 0
    ? ballPrimary < fieldPrimarySize * 0.6
    : ballPrimary > fieldPrimarySize * 0.4;

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.y - selfPos.y);

  if (distToBall < 200 || ballIsOnMySide) {
    return { target: { x: ballPos.x, y: ballPos.y } };
  }

  const target = { x: ballPos.x, y: ballPos.y };
  target[axis] = (ballPrimary + ownGoalValue) / 2;
  return { target };
}
