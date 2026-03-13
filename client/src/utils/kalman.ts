/**
 * Kalman filter for 1-D scalar smoothing (RSSI values).
 *
 * Uses a simple scalar Kalman filter:
 *   Predict:  x̂⁻ = x̂, P⁻ = P + Q
 *   Update:   K  = P⁻ / (P⁻ + R)
 *             x̂  = x̂⁻ + K(z − x̂⁻)
 *             P  = (1 − K) P⁻
 */

/**
 * Scalar Kalman filter for smoothing noisy 1-D sensor readings (e.g. RSSI).
 *
 * Two tuning knobs:
 * - `q` (process noise): how quickly the true signal can change between
 *   readings. Higher `q` → filter trusts new measurements more, reacts faster.
 * - `r` (measurement noise): expected variance of individual sensor readings.
 *   Higher `r` → filter trusts its own estimate more, smooths more aggressively.
 *
 * Typical starting point for Wi-Fi RSSI: `q = 0.008`, `r = 1`.
 */
export class KalmanFilter {
  private x: number      // state estimate
  private p: number      // estimate covariance

  /**
   * @param q Process noise covariance (how fast the true value can change)
   * @param r Measurement noise covariance (how noisy individual readings are)
   * @param initialValue Initial state estimate (use first measurement)
   */
  constructor(
    private readonly q: number = 0.008,
    private readonly r: number = 1,
    initialValue: number = -70,
  ) {
    this.x = initialValue
    this.p = 1
  }

  /**
   * Feed a new measurement; returns the smoothed estimate.
   *
   * @param measurement  Raw sensor value (e.g. dBm RSSI reading).
   * @returns The updated state estimate `x̂` after incorporating the measurement.
   */
  update(measurement: number): number {
    // Predict
    const pMinus = this.p + this.q

    // Update
    const k = pMinus / (pMinus + this.r)
    this.x = this.x + k * (measurement - this.x)
    this.p = (1 - k) * pMinus

    return this.x
  }

  /** Current smoothed estimate without consuming a new measurement. */
  get value(): number {
    return this.x
  }

  /**
   * Reset to a new initial value (e.g. after a long gap in sightings).
   *
   * Resets `p` (estimate covariance) to `1` as well, so the filter converges
   * quickly from the new initial estimate rather than inheriting the confidence
   * level built up from previous readings.
   *
   * @param initialValue  New state estimate to start from.
   */
  reset(initialValue: number): void {
    this.x = initialValue
    this.p = 1
  }
}
