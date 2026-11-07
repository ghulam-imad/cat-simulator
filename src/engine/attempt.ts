import type { Difficulty, ExerciseSet, Question } from "./exercise-set.js";

export interface Attempt {
  set: ExerciseSet;
  student: string;
  startedAt: number;
  random: () => number;
  /** The first (Medium) Question of every Subject, drawn up front so viewing never needs randomness. */
  firstQuestions: Question[];
  /** The Question the Student answers next, unless its Subject's Window has closed by then. */
  cursor: Position;
  responses: Response[];
  /** Every change of ticked Options, in order, before each Response was submitted. */
  selectionChanges: SelectionChange[];
}

export interface SelectionChange {
  questionId: string;
  selected: number[];
  at: number;
}

export interface Response {
  subjectIndex: number;
  question: Question;
  selected: number[];
  submittedAt: number;
}

export type View =
  | { kind: "question"; subject: string; question: Question; selected: number[] }
  | { kind: "waiting"; nextSubject: string; opensAt: number }
  | { kind: "finished"; subjects: SubjectResult[] };

export interface SubjectResult {
  subject: string;
  score: number;
  correct: number;
  questions: number;
}

type Position = { subjectIndex: number; question: Question } | "finished";

export interface StartOptions {
  student: string;
  /** Epoch ms when the Student pressed Start. */
  startedAt: number;
  /** Returns a number in [0, 1); used to draw Questions from a Pool. */
  random?: () => number;
}

const POINTS: Record<Difficulty, number> = { high: 3, medium: 2, low: 1 };
const HARDER: Record<Difficulty, Difficulty> = { low: "medium", medium: "high", high: "high" };
const EASIER: Record<Difficulty, Difficulty> = { high: "medium", medium: "low", low: "low" };

export function startAttempt(set: ExerciseSet, opts: StartOptions): Attempt {
  const random = opts.random ?? Math.random;
  const firstQuestions = set.subjects.map((_, i) => draw(set, i, "medium", random, new Set()));
  return {
    set,
    student: opts.student,
    startedAt: opts.startedAt,
    random,
    firstQuestions,
    cursor: { subjectIndex: 0, question: firstQuestions[0]! },
    responses: [],
    selectionChanges: [],
  };
}

/** The Student ticked or unticked an Option on the Question in front of them. */
export function changeSelection(attempt: Attempt, selected: number[], at: number): Attempt {
  const position = positionAt(attempt, at);
  if (position === "finished") throw new Error("The Attempt is finished");
  const change = { questionId: position.question.id, selected, at };
  return { ...attempt, selectionChanges: [...attempt.selectionChanges, change] };
}

export function submitResponse(attempt: Attempt, selected: number[], at: number): Attempt {
  const position = positionAt(attempt, at);
  if (position === "finished") throw new Error("The Attempt is finished");
  const { subjectIndex, question } = position;
  const opensAt = attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).opensAt);
  if (at < opensAt) {
    throw new Error(`${attempt.set.subjects[subjectIndex]!.name} opens at ${new Date(opensAt).toISOString()}`);
  }
  const responses = [...attempt.responses, { subjectIndex, question, selected, submittedAt: at }];
  const answeredInSubject = responses.filter((r) => r.subjectIndex === subjectIndex).length;
  if (answeredInSubject === questionsPerSubject(attempt.set, subjectIndex)) {
    return { ...attempt, cursor: startOfSubject(attempt, subjectIndex + 1), responses };
  }
  const seen = new Set(responses.map((r) => r.question.id));
  const difficulty = isCorrect(question, selected) ? HARDER[question.difficulty] : EASIER[question.difficulty];
  const next = draw(attempt.set, subjectIndex, difficulty, attempt.random, seen);
  return { ...attempt, cursor: { subjectIndex, question: next }, responses };
}

export function viewAt(attempt: Attempt, at: number): View {
  const position = positionAt(attempt, at);
  if (position === "finished") return { kind: "finished", subjects: results(attempt) };
  const { subjectIndex, question } = position;
  const subject = attempt.set.subjects[subjectIndex]!;
  const opensAt = attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).opensAt);
  if (at < opensAt) return { kind: "waiting", nextSubject: subject.name, opensAt };
  const lastChange = attempt.selectionChanges.findLast((c) => c.questionId === question.id);
  return { kind: "question", subject: subject.name, question, selected: lastChange?.selected ?? [] };
}

export interface Review {
  subjects: { subject: string; timedOut: boolean; difficultyPath: Difficulty[]; responses: ReviewedResponse[] }[];
}

export interface ReviewedResponse {
  question: Question;
  selected: number[];
  submittedAt: number;
  correct: boolean;
  points: number;
  secondsSpent: number;
  /** Submitted after the Subject's Work Time ended, in its Lag. */
  inLag: boolean;
  /** How the ticks changed before submitting, oldest first. */
  selectionChanges: { selected: number[]; at: number }[];
}

/** Everything the Parent needs to go through an Attempt with the Student. */
export function reviewAt(attempt: Attempt, at: number): Review {
  return {
    subjects: attempt.set.subjects.map((subject, subjectIndex) => {
      const responses = attempt.responses.filter((r) => r.subjectIndex === subjectIndex);
      return {
        subject: subject.name,
        timedOut:
          responses.length < questionsPerSubject(attempt.set, subjectIndex) &&
          at >= attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).closesAt),
        difficultyPath: responses.map((r) => r.question.difficulty),
        responses: responses.map((r, i) => {
          const shownAt = i === 0 ? subjectStartedAt(attempt, subjectIndex) : responses[i - 1]!.submittedAt;
          const correct = isCorrect(r.question, r.selected);
          return {
            question: r.question,
            selected: r.selected,
            submittedAt: r.submittedAt,
            correct,
            points: correct ? POINTS[r.question.difficulty] : 0,
            secondsSpent: (r.submittedAt - shownAt) / 1000,
            inLag: r.submittedAt >= attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).workEndsAt),
            selectionChanges: attempt.selectionChanges
              .filter((c) => c.questionId === r.question.id)
              .map(({ selected, at }) => ({ selected, at })),
          };
        }),
      };
    }),
  };
}

/** When the Student could begin a Subject: once it was open and the previous Subject was over. */
function subjectStartedAt(attempt: Attempt, subjectIndex: number): number {
  const opensAt = attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).opensAt);
  if (subjectIndex === 0) return opensAt;
  return Math.max(opensAt, subjectEndedAt(attempt, subjectIndex - 1));
}

/** When a Subject was over: its last Response if every Question was answered, otherwise when its Window closed. */
function subjectEndedAt(attempt: Attempt, subjectIndex: number): number {
  const responses = attempt.responses.filter((r) => r.subjectIndex === subjectIndex);
  if (responses.length === questionsPerSubject(attempt.set, subjectIndex)) return responses.at(-1)!.submittedAt;
  return attempt.startedAt + minutesToMs(windowOf(attempt.set, subjectIndex).closesAt);
}

function results(attempt: Attempt): SubjectResult[] {
  return attempt.set.subjects.map((subject, subjectIndex) => {
    const correct = attempt.responses.filter((r) => r.subjectIndex === subjectIndex && isCorrect(r.question, r.selected));
    return {
      subject: subject.name,
      score: correct.reduce((sum, r) => sum + POINTS[r.question.difficulty], 0),
      correct: correct.length,
      questions: questionsPerSubject(attempt.set, subjectIndex),
    };
  });
}

/** Where the Student is at time `at`: the cursor, moved past every Subject whose Window has closed. */
function positionAt(attempt: Attempt, at: number): Position {
  let position = attempt.cursor;
  while (position !== "finished" && at >= attempt.startedAt + minutesToMs(windowOf(attempt.set, position.subjectIndex).closesAt)) {
    position = startOfSubject(attempt, position.subjectIndex + 1);
  }
  return position;
}

function startOfSubject(attempt: Attempt, subjectIndex: number): Position {
  const question = attempt.firstQuestions[subjectIndex];
  return question ? { subjectIndex, question } : "finished";
}

/** A Subject's Window, in minutes after Start. */
function windowOf(set: ExerciseSet, subjectIndex: number): { opensAt: number; workEndsAt: number; closesAt: number } {
  const subject = set.subjects[subjectIndex]!;
  const workStartsAt = set.subjects.slice(0, subjectIndex).reduce((sum, s) => sum + s.workMinutes, 0);
  return {
    opensAt: workStartsAt - subject.leadMinutes,
    workEndsAt: workStartsAt + subject.workMinutes,
    closesAt: workStartsAt + subject.workMinutes + subject.lagMinutes,
  };
}

/** A Subject shows as many Questions as each of its Pools holds. */
function questionsPerSubject(set: ExerciseSet, subjectIndex: number): number {
  return set.subjects[subjectIndex]!.questions.filter((q) => q.difficulty === "medium").length;
}

const minutesToMs = (minutes: number) => minutes * 60_000;

function draw(
  set: ExerciseSet,
  subjectIndex: number,
  difficulty: Difficulty,
  random: () => number,
  seen: Set<string>,
): Question {
  const pool = set.subjects[subjectIndex]!.questions.filter((q) => q.difficulty === difficulty && !seen.has(q.id));
  return pool[Math.floor(random() * pool.length)]!;
}

function isCorrect(question: Question, selected: number[]): boolean {
  return selected.length === question.correctOptions.length && selected.every((i) => question.correctOptions.includes(i));
}
