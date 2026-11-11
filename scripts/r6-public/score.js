function scoreR6(weights, ticks) {
  if (weights.length !== 6 || ticks.length !== 6 ||
      ticks.some((tick) => !Number.isInteger(tick) || tick < 1 || tick > 10)) {
    return null;
  }

  // A half-star tick is one point on the 10-point scale. Summing
  // tick × percentage points gives the score in hundredths.
  let numerator = 0n;
  let denominator = 1n;
  weights.forEach((weight, index) => {
    const [weightNumerator, weightDenominator] = weight.split("/").map(BigInt);
    numerator = numerator * weightDenominator + denominator * weightNumerator * BigInt(ticks[index]);
    denominator *= weightDenominator;
  });
  const cents = (2n * numerator + denominator) / (2n * denominator);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
