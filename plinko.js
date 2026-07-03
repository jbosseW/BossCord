// plinko.js — Server-side Plinko game logic for BossCord
// Ball drops through rows of pegs, lands in a multiplier slot.
// All randomness is server-side for fairness.

const crypto = require('crypto');

const ROWS = 12; // number of peg rows
// Multipliers for 13 slots (ROWS + 1 slots)
// Classic Plinko: high on edges, low in center (risk/reward)
const MULTIPLIERS = [10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10];
const MIN_BET = 10;
const MAX_BET = 100000; // 100K max bet (capped to limit 10x edge multiplier risk)

/**
 * Simulate a Plinko drop. Returns the path (array of 'L'/'R' for each row)
 * and the final slot index + multiplier.
 */
function drop() {
  var path = [];
  var position = 0; // starts at center-ish (0 = leftmost possibility)

  for (var i = 0; i < ROWS; i++) {
    // Each peg: 50/50 chance to go left or right
    var goRight = crypto.randomInt(2) === 1;
    path.push(goRight ? 'R' : 'L');
    if (goRight) position++;
  }

  // position is now 0..ROWS, which maps to slot index 0..ROWS (13 slots)
  var slotIndex = Math.min(position, MULTIPLIERS.length - 1);
  var multiplier = MULTIPLIERS[slotIndex];

  return {
    path: path,
    slotIndex: slotIndex,
    multiplier: multiplier,
    rows: ROWS,
  };
}

/**
 * Calculate payout for a given bet and multiplier.
 */
function payout(bet, multiplier) {
  return Math.floor(bet * multiplier);
}

module.exports = {
  drop,
  payout,
  ROWS,
  MULTIPLIERS,
  MIN_BET,
  MAX_BET,
};
