/**
 * Spurt Calculation Utilities
 *
 * Ported from umasim RaceCalculator.kt. The full HP/spurt-planning port used to
 * live here; it was retired with the TS simulation oracle (ADR-0006) and only
 * the pieces the app still consumes remain.
 */

export interface SpurtCandidate {
  transitionPosition: number; // Position where spurt begins
  speed: number; // Spurt speed
  distance: number; // Distance of spurt
  time: number; // Total time to complete race
  hpDiff: number; // HP remaining after race
}

/**
 * Calculate estimated average speed during early-race start dash phase
 *
 * During start dash, uma accelerates from 3 m/s to 0.85 × baseSpeed.
 * This returns the average speed during that acceleration period,
 * which is used to estimate distance traveled for time-based skill conditions.
 *
 * @param distance Course distance in meters
 * @returns Estimated average speed in m/s during start dash
 */
export function calculateEarlyRaceAverageSpeed(distance: number): number {
  const baseSpeed = calculateBaseSpeed(distance);
  const startSpeed = 3.0;
  const startDashThreshold = 0.85 * baseSpeed;

  // Average of starting speed and threshold speed
  return (startSpeed + startDashThreshold) / 2;
}

/**
 * Calculate base speed for a course
 */
function calculateBaseSpeed(distance: number): number {
  return 20.0 - (distance - 2000) / 1000.0;
}
