export type Vector = number[];

export function normalize(vectors: Vector[]): Vector[] {
  if (vectors.length === 0) return [];
  const width = vectors[0].length;
  const min = Array.from({ length: width }, (_, d) => Math.min(...vectors.map((v) => v[d])));
  const max = Array.from({ length: width }, (_, d) => Math.max(...vectors.map((v) => v[d])));
  return vectors.map((vector) => vector.map((value, d) => (max[d] === min[d] ? 0 : (value - min[d]) / (max[d] - min[d]))));
}

const distance = (a: Vector, b: Vector) => a.reduce((sum, value, d) => sum + (value - b[d]) ** 2, 0);

const nearest = (vector: Vector, centroids: Vector[]) =>
  centroids.reduce((best, centroid, index) => (distance(vector, centroid) < distance(vector, centroids[best]) ? index : best), 0);

function farthestFirst(vectors: Vector[], k: number): Vector[] {
  const centroids = [vectors[0]];
  while (centroids.length < k) {
    const next = vectors.reduce((best, vector) => {
      const gap = Math.min(...centroids.map((centroid) => distance(vector, centroid)));
      return gap > best.gap ? { vector, gap } : best;
    }, { vector: vectors[0], gap: -1 });
    centroids.push(next.vector);
  }
  return centroids;
}

export function kMeans(vectors: Vector[], k: number, maxIterations = 100): number[] {
  const groups = Math.max(1, Math.min(k, vectors.length));
  if (vectors.length === 0) return [];

  let centroids = farthestFirst(vectors, groups);
  let assignments = vectors.map((vector) => nearest(vector, centroids));

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    centroids = centroids.map((centroid, index) => {
      const members = vectors.filter((_, i) => assignments[i] === index);
      return members.length
        ? centroid.map((_, d) => members.reduce((sum, member) => sum + member[d], 0) / members.length)
        : centroid;
    });
    const next = vectors.map((vector) => nearest(vector, centroids));
    if (next.every((group, i) => group === assignments[i])) break;
    assignments = next;
  }

  return assignments;
}
