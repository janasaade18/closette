/**
 * Shared linear LinUCB.
 *
 * One parameter vector is shared across outfits for a single user. A candidate
 * is an arm only for the current request, described by the seven baseline
 * content features. Phase 2 fits one instance per user from feedback and blends
 * it with the learned (or baseline) ranker in ranking/rank.js.
 */

function zeros(n) {
  return Array.from({ length: n }, () => 0);
}

function identity(n) {
  return Array.from({ length: n }, (_, row) => zeros(n).map((_, col) => (row === col ? 1 : 0)));
}

function cloneMatrix(matrix) {
  return matrix.map((row) => [...row]);
}

export function invertMatrix(matrix) {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [...row, ...identity(n)[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) {
      throw new Error("LinUCB design matrix is singular");
    }
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const scale = augmented[col][col];
    for (let column = 0; column < n * 2; column += 1) augmented[col][column] /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let column = 0; column < n * 2; column += 1) {
        augmented[row][column] -= factor * augmented[col][column];
      }
    }
  }
  return augmented.map((row) => row.slice(n));
}

function matVec(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

export const BASELINE_FEATURES = [
  "occasion_match",
  "style_match",
  "garment_type_preference",
  "color_preference",
  "color_harmony",
  "weather_suitability",
  "context_layer",
];

export class SharedLinUCB {
  constructor({ dim = BASELINE_FEATURES.length, alpha = 0.8 } = {}) {
    this.dim = dim;
    this.alpha = alpha;
    this.A = identity(dim);
    this.b = zeros(dim);
  }

  score(features) {
    if (features.length !== this.dim) {
      throw new Error(`Expected ${this.dim} features`);
    }
    const inverse = invertMatrix(this.A);
    const theta = matVec(inverse, this.b);
    const mean = dot(theta, features);
    const confidence = Math.sqrt(Math.max(0, dot(features, matVec(inverse, features))));
    return {
      mean,
      bonus: this.alpha * confidence,
      total: mean + this.alpha * confidence,
    };
  }

  update(features, reward) {
    if (features.length !== this.dim) {
      throw new Error(`Expected ${this.dim} features`);
    }
    const next = cloneMatrix(this.A);
    for (let row = 0; row < this.dim; row += 1) {
      for (let col = 0; col < this.dim; col += 1) {
        next[row][col] += features[row] * features[col];
      }
      this.b[row] += reward * features[row];
    }
    this.A = next;
  }
}
