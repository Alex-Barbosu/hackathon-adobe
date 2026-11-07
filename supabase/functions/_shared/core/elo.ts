export const ELO_START = 1000;
export const ELO_K = 32;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function updatePair(winner: number, loser: number, k: number = ELO_K): [number, number] {
  const e = expectedScore(winner, loser);
  return [winner + k * (1 - e), loser - k * (1 - e)];
}

// "Neither": the direction loses to a virtual 1000-rated opponent, i.e. exactly 16 points at 1000.
export function updateNeither(rating: number): number {
  return rating - ELO_K * expectedScore(rating, ELO_START);
}
