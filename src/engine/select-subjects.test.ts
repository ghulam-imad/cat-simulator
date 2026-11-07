import { describe, expect, test } from "vitest";
import type { ExerciseSet, Subject } from "./exercise-set.js";
import { selectSubjects } from "./select-subjects.js";

const subject = (name: string, workMinutes: number, leadMinutes: number, lagMinutes: number): Subject => ({
  name,
  workMinutes,
  leadMinutes,
  lagMinutes,
  questions: [],
});

/** Shaped like the Labsky sets. */
const labsky: ExerciseSet = {
  number: "labsky-001",
  subjects: [
    subject("Kuantitatif", 27, 0, 5),
    subject("Literasi", 25, 15, 5),
    subject("Verbal", 8, 5, 5),
    subject("Akademik", 30, 5, 0),
  ],
};

const timing = (set: ExerciseSet) => set.subjects.map((s) => [s.name, s.workMinutes, s.leadMinutes, s.lagMinutes]);

describe("Selected Subjects", () => {
  test("keep the Exercise Set's order, whatever order they were picked in", () => {
    const picked = selectSubjects(labsky, ["Akademik", "Kuantitatif"]);

    expect(picked.subjects.map((s) => s.name)).toEqual(["Kuantitatif", "Akademik"]);
    expect(picked.number).toBe("labsky-001");
  });

  test("keep their own Work Time, Lead and Lag, except the first has no Lead and the last no Lag", () => {
    const picked = selectSubjects(labsky, ["Literasi", "Verbal"]);

    expect(timing(picked)).toEqual([
      ["Literasi", 25, 0, 5],
      ["Verbal", 8, 5, 0],
    ]);
  });

  test("a Lead or Lag never reaches past the neighbouring Subject's Work Time", () => {
    // Literasi's 15-minute Lead would now overlap Verbal's whole 8-minute Work Time.
    const picked = selectSubjects(labsky, ["Verbal", "Literasi", "Kuantitatif"]);
    const shortFirst: ExerciseSet = {
      number: "x",
      subjects: [subject("A", 30, 0, 5), subject("B", 3, 0, 0), subject("C", 20, 15, 0)],
    };

    expect(timing(picked)).toEqual([
      ["Kuantitatif", 27, 0, 5],
      ["Literasi", 25, 15, 5],
      ["Verbal", 8, 5, 0],
    ]);
    expect(timing(selectSubjects(shortFirst, ["B", "C"]))).toEqual([
      ["B", 3, 0, 0],
      ["C", 20, 3, 0],
    ]);
    expect(timing(selectSubjects({ number: "y", subjects: [subject("A", 30, 0, 10), subject("B", 4, 0, 0), subject("C", 20, 0, 0)] }, ["A", "B"]))).toEqual([
      ["A", 30, 0, 4],
      ["B", 4, 0, 0],
    ]);
  });

  test("picking every Subject gives the Exercise Set unchanged", () => {
    expect(selectSubjects(labsky, ["Verbal", "Akademik", "Literasi", "Kuantitatif"])).toEqual(labsky);
  });

  test("are refused when none is picked, or one isn't in the Exercise Set", () => {
    expect(() => selectSubjects(labsky, [])).toThrow("Pick at least one Subject.");
    expect(() => selectSubjects(labsky, ["Kuantitatif", "Biologi"])).toThrow("Exercise Set labsky-001 has no Subject Biologi.");
  });
});
