import { describe, expect, test } from "vitest";
import { type Attempt, changeSelection, reviewAt, startAttempt, submitResponse, viewAt } from "./attempt.js";
import type { Difficulty, ExerciseSet, Question, Subject } from "./exercise-set.js";

const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const minute = (m: number) => T0 + m * 60_000;

/** Builds a Subject whose Pools each hold `perPool` Questions with ids like "Math-H1", "Math-M2". Option 0 is correct. */
function subject(
  name: string,
  opts: { work: number; lead?: number; lag?: number; perPool?: number; correctOptions?: number[] },
): Subject {
  const perPool = opts.perPool ?? 3;
  const questions: Question[] = [];
  for (const [difficulty, letter] of [
    ["high", "H"],
    ["medium", "M"],
    ["low", "L"],
  ] as [Difficulty, string][]) {
    for (let i = 1; i <= perPool; i++) {
      questions.push({
        id: `${name}-${letter}${i}`,
        difficulty,
        text: `${name} ${difficulty} question ${i}`,
        options: ["right", "wrong 1", "wrong 2", "wrong 3"],
        correctOptions: opts.correctOptions ?? [0],
      });
    }
  }
  return {
    name,
    workMinutes: opts.work,
    leadMinutes: opts.lead ?? 0,
    lagMinutes: opts.lag ?? 0,
    questions,
  };
}

function exerciseSet(...subjects: Subject[]): ExerciseSet {
  return { number: "7", subjects };
}

/** Always draws the first remaining Question of a Pool, so tests are deterministic. */
const firstInPool = () => 0;

describe("starting an Attempt", () => {
  test("the Student first sees a Medium Question from the first Subject", () => {
    const set = exerciseSet(subject("Math", { work: 20 }), subject("English", { work: 10 }));

    const attempt = startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });

    expect(viewAt(attempt, T0)).toMatchObject({
      kind: "question",
      subject: "Math",
      question: { id: "Math-M1", difficulty: "medium" },
    });
  });
});

describe("Adaptive Selection", () => {
  const set = exerciseSet(subject("Math", { work: 20 }), subject("English", { work: 10 }));
  const start = () => startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });
  const RIGHT = [0];
  const WRONG = [1];

  test("a correct Response moves the next Question up one Difficulty", () => {
    const attempt = submitResponse(start(), RIGHT, minute(1));

    expect(viewAt(attempt, minute(1))).toMatchObject({ question: { id: "Math-H1" } });
  });

  test("a wrong Response moves the next Question down one Difficulty", () => {
    const attempt = submitResponse(start(), WRONG, minute(1));

    expect(viewAt(attempt, minute(1))).toMatchObject({ question: { id: "Math-L1" } });
  });

  test("at High a correct Response stays High, with a Question not seen before", () => {
    let attempt = submitResponse(start(), RIGHT, minute(1)); // M1 -> H1
    attempt = submitResponse(attempt, RIGHT, minute(2)); // H1 -> H?

    expect(viewAt(attempt, minute(2))).toMatchObject({ question: { id: "Math-H2" } });
  });

  test("at Low a wrong Response stays Low, with a Question not seen before", () => {
    let attempt = submitResponse(start(), WRONG, minute(1)); // M1 -> L1
    attempt = submitResponse(attempt, WRONG, minute(2)); // L1 -> L?

    expect(viewAt(attempt, minute(2))).toMatchObject({ question: { id: "Math-L2" } });
  });
});

describe("the shared clock", () => {
  // Math work 0–20, lag to 25. English lead from 15, work 20–30. Exercise Set ends at 30.
  const set = exerciseSet(
    subject("Math", { work: 20, lag: 5, perPool: 3 }),
    subject("English", { work: 10, lead: 5, perPool: 3 }),
  );
  const start = () => startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });
  const answerAll = (attempt: Attempt, count: number, finishAt: number) => {
    for (let i = 0; i < count; i++) attempt = submitResponse(attempt, [0], finishAt);
    return attempt;
  };

  test("finishing Math early means waiting until English opens at the start of its Lead", () => {
    const attempt = answerAll(start(), 3, minute(5));

    expect(viewAt(attempt, minute(5))).toEqual({ kind: "waiting", nextSubject: "English", opensAt: minute(15) });
  });

  test("when Math's Window closes at the end of its Lag, Math is Timed Out and English begins", () => {
    const attempt = submitResponse(start(), [0], minute(1)); // 1 of 3 Math Questions answered

    expect(viewAt(attempt, minute(24))).toMatchObject({ kind: "question", subject: "Math" });
    expect(viewAt(attempt, minute(25))).toMatchObject({ kind: "question", subject: "English", question: { id: "English-M1" } });
  });

  test("the Attempt is finished when the last Subject's Window closes, at the sum of the Work Times", () => {
    const attempt = answerAll(start(), 3, minute(5)); // Math done, English never answered

    expect(viewAt(attempt, minute(29))).toMatchObject({ kind: "question", subject: "English" });
    expect(viewAt(attempt, minute(30))).toMatchObject({ kind: "finished" });
  });

  test("S1: finishing Math at minute 5, the Student starts English when it opens at minute 15", () => {
    const attempt = answerAll(start(), 3, minute(5));

    expect(viewAt(attempt, minute(15))).toMatchObject({ kind: "question", subject: "English", question: { id: "English-M1" } });
  });

  test("S2: Math can still be answered during its Lag, and that time comes out of English", () => {
    let attempt = submitResponse(start(), [0], minute(1));
    attempt = submitResponse(attempt, [0], minute(21));
    attempt = submitResponse(attempt, [0], minute(24)); // last Math Question, in Lag

    expect(viewAt(attempt, minute(24))).toMatchObject({ kind: "question", subject: "English" });
    expect(viewAt(attempt, minute(30))).toMatchObject({ kind: "finished" });
  });

  test("S3: finishing Math at minute 17, English is already open and starts straight away", () => {
    const attempt = answerAll(start(), 3, minute(17));

    expect(viewAt(attempt, minute(17))).toMatchObject({ kind: "question", subject: "English" });
  });

  test("a Question shows its number in the Subject and when the Work Time ends and the Window closes", () => {
    const attempt = submitResponse(start(), [0], minute(1));

    expect(viewAt(attempt, minute(2))).toMatchObject({
      kind: "question",
      subject: "Math",
      questionNumber: 2,
      questionCount: 3,
      workEndsAt: minute(20),
      closesAt: minute(25),
    });
  });

  test("a Response cannot be submitted while waiting for the next Subject to open", () => {
    const attempt = answerAll(start(), 3, minute(5));

    expect(() => submitResponse(attempt, [0], minute(10))).toThrow("English opens at");
  });
});

describe("Multi-answer Questions", () => {
  // Every Question has Correct Options A and C.
  const set = exerciseSet(subject("Math", { work: 20, perPool: 1, correctOptions: [0, 2] }));
  const scoreFor = (selected: number[]) => {
    const attempt = submitResponse(startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool }), selected, minute(1));
    const view = viewAt(attempt, minute(1));
    return view.kind === "finished" ? view.subjects[0]!.score : undefined;
  };

  test("picking every Correct Option, in any order, earns the points", () => {
    expect(scoreFor([2, 0])).toBe(2);
  });

  test("picking only some of the Correct Options earns nothing", () => {
    expect(scoreFor([0])).toBe(0);
  });

  test("picking the Correct Options plus a wrong one earns nothing", () => {
    expect(scoreFor([0, 1, 2])).toBe(0);
  });
});

describe("Score", () => {
  const set = exerciseSet(
    subject("Math", { work: 20, lag: 5, perPool: 3 }),
    subject("English", { work: 10, lead: 5, perPool: 3 }),
  );
  const start = () => startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });

  test("each Subject scores its correct Responses' Difficulty points; unanswered Questions score 0", () => {
    let attempt = submitResponse(start(), [0], minute(1)); // Medium, right: 2
    attempt = submitResponse(attempt, [0], minute(2)); // High, right: 3
    attempt = submitResponse(attempt, [2], minute(3)); // High, wrong: 0
    // English is never answered and Times Out.

    expect(viewAt(attempt, minute(30))).toEqual({
      kind: "finished",
      subjects: [
        { subject: "Math", score: 5, correct: 2, questions: 3 },
        { subject: "English", score: 0, correct: 0, questions: 3 },
      ],
    });
  });
});

describe("review", () => {
  const set = exerciseSet(
    subject("Math", { work: 20, lag: 5, perPool: 3 }),
    subject("English", { work: 10, lead: 5, perPool: 3 }),
  );
  const start = () => startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });

  test("records how long the Student spent on each Question", () => {
    let attempt = submitResponse(start(), [0], minute(2));
    attempt = submitResponse(attempt, [0], minute(5));
    attempt = submitResponse(attempt, [0], minute(6));

    const math = reviewAt(attempt, minute(30)).subjects[0]!;

    expect(math.responses.map((r) => r.secondsSpent)).toEqual([120, 180, 60]);
  });

  test("the first Question of a Subject is timed from when the Student could start it", () => {
    const answerMath = (finishAt: number) => {
      let attempt = start();
      for (let i = 0; i < 3; i++) attempt = submitResponse(attempt, [0], finishAt);
      return attempt;
    };
    const firstEnglishSeconds = (attempt: Attempt) => reviewAt(attempt, minute(30)).subjects[1]!.responses[0]!.secondsSpent;

    // Math done at 6, English opens at 15: waiting time doesn't count.
    expect(firstEnglishSeconds(submitResponse(answerMath(minute(6)), [0], minute(16)))).toBe(60);
    // Math done at 17, English already open: timed from 17.
    expect(firstEnglishSeconds(submitResponse(answerMath(minute(17)), [0], minute(18)))).toBe(60);
  });

  test("shows the Difficulty Path the Student took through each Subject", () => {
    let attempt = submitResponse(start(), [0], minute(1)); // Medium, right
    attempt = submitResponse(attempt, [1], minute(2)); // High, wrong
    attempt = submitResponse(attempt, [1], minute(3)); // Medium, wrong

    expect(reviewAt(attempt, minute(30)).subjects[0]!.difficultyPath).toEqual(["medium", "high", "medium"]);
  });

  test("a Subject is Timed Out only once its Window has closed with Questions unanswered", () => {
    const attempt = submitResponse(start(), [0], minute(1)); // 1 of 3 Math Questions

    expect(reviewAt(attempt, minute(24)).subjects[0]!.timedOut).toBe(false);
    expect(reviewAt(attempt, minute(25)).subjects[0]!.timedOut).toBe(true);
  });

  test("a Subject with every Question answered is not Timed Out", () => {
    let attempt = start();
    for (let i = 0; i < 3; i++) attempt = submitResponse(attempt, [0], minute(5));

    expect(reviewAt(attempt, minute(30)).subjects[0]!.timedOut).toBe(false);
  });

  test("flags Responses submitted after the Subject's Work Time ended, during its Lag", () => {
    let attempt = submitResponse(start(), [0], minute(19));
    attempt = submitResponse(attempt, [0], minute(20));
    attempt = submitResponse(attempt, [0], minute(24));

    expect(reviewAt(attempt, minute(30)).subjects[0]!.responses.map((r) => r.inLag)).toEqual([false, true, true]);
  });

  test("shows whether each Response was correct and the points it earned", () => {
    let attempt = submitResponse(start(), [0], minute(1)); // Medium, right
    attempt = submitResponse(attempt, [3], minute(2)); // High, wrong

    const responses = reviewAt(attempt, minute(30)).subjects[0]!.responses;

    expect(responses.map((r) => [r.correct, r.points])).toEqual([
      [true, 2],
      [false, 0],
    ]);
  });
});

describe("ticking Options before submitting", () => {
  const set = exerciseSet(subject("Math", { work: 20, perPool: 3 }));
  const start = () => startAttempt(set, { student: "Aisha", startedAt: T0, random: firstInPool });

  test("the Question is shown with the Options the Student last ticked", () => {
    let attempt = changeSelection(start(), [1], minute(1));
    attempt = changeSelection(attempt, [2], minute(2));

    expect(viewAt(attempt, minute(3))).toMatchObject({ question: { id: "Math-M1" }, selected: [2] });
  });

  test("the review lists every change of ticks before each Response was submitted", () => {
    let attempt = changeSelection(start(), [1], minute(1));
    attempt = changeSelection(attempt, [2], minute(2));
    attempt = submitResponse(attempt, [2], minute(3));
    attempt = submitResponse(attempt, [0], minute(4)); // submitted without changing ticks first

    const responses = reviewAt(attempt, minute(20)).subjects[0]!.responses;

    expect(responses.map((r) => r.selectionChanges)).toEqual([
      [
        { selected: [1], at: minute(1) },
        { selected: [2], at: minute(2) },
      ],
      [],
    ]);
  });
});
