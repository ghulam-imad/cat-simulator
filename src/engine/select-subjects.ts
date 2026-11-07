import type { ExerciseSet } from "./exercise-set.js";

/**
 * The Exercise Set cut down to the Selected Subjects, still in the set's own order.
 * Each keeps its Work Time, Lead and Lag, except that the first has no Lead, the last has no Lag,
 * and no Lead or Lag is longer than the neighbouring Subject's Work Time.
 */
export function selectSubjects(set: ExerciseSet, names: string[]): ExerciseSet {
  if (names.length === 0) throw new Error("Pick at least one Subject.");
  const missing = names.find((name) => !set.subjects.some((s) => s.name === name));
  if (missing !== undefined) throw new Error(`Exercise Set ${set.number} has no Subject ${missing}.`);

  const kept = set.subjects.filter((s) => names.includes(s.name));
  if (kept.length === set.subjects.length) return set;
  return {
    ...set,
    subjects: kept.map((s, i) => ({
      ...s,
      leadMinutes: i === 0 ? 0 : Math.min(s.leadMinutes, kept[i - 1]!.workMinutes),
      lagMinutes: i === kept.length - 1 ? 0 : Math.min(s.lagMinutes, kept[i + 1]!.workMinutes),
    })),
  };
}
