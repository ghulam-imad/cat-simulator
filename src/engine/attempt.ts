import type { Difficulty, ExerciseSet, Question } from "./exercise-set.js";

export interface Attempt {
  set: ExerciseSet;
  student: string;
  startedAt: number;
  random: () => number;
  /** Shuffles every Question's Options for this Attempt; see `optionOrder`. Absent: Options keep their written order. */
  optionSeed?: number;
  /** The first (Low) Question of every Subject, drawn up front so viewing never needs randomness. */
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
  | {
      kind: "question";
      subject: string;
      question: Question;
      selected: number[];
      /** 1-based position of this Question within its Subject, out of `questionCount`. */
      /** The order to show the Options in: position on screen -> index into `question.options`. */
      optionOrder: number[];
      questionNumber: number;
      questionCount: number;
      /** Epoch ms when the Subject's Work Time ends; after this the Student is in Lag. */
      workEndsAt: number;
      /** Epoch ms when the Subject's Window closes. */
      closesAt: number;
    }
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
  /**
   * Any 32-bit number; shuffles the Options, differently for each seed. Kept apart from `random`
   * so shuffling never changes which Questions are drawn. Without it, Options keep their written order.
   */
  optionSeed?: number;
}

/** Adaptive Selection starts every Subject here, with a random Question from this Pool. */
const FIRST_DIFFICULTY: Difficulty = "low";
const POINTS: Record<Difficulty, number> = { high: 3, medium: 2, low: 1 };
const HARDER: Record<Difficulty, Difficulty> = { low: "medium", medium: "high", high: "high" };
const EASIER: Record<Difficulty, Difficulty> = { high: "medium", medium: "low", low: "low" };

export function startAttempt(set: ExerciseSet, opts: StartOptions): Attempt {
  const random = opts.random ?? Math.random;
  const firstQuestions = set.subjects.map((_, i) => draw(set, i, FIRST_DIFFICULTY, random, new Set()));
  return {
    set,
    student: opts.student,
    startedAt: opts.startedAt,
    random,
    ...(opts.optionSeed === undefined ? {} : { optionSeed: opts.optionSeed }),
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
  const window = windowOf(attempt.set, subjectIndex);
  return {
    kind: "question",
    subject: subject.name,
    question,
    selected: lastChange?.selected ?? [],
    optionOrder: optionOrder(attempt, question),
    questionNumber: attempt.responses.filter((r) => r.subjectIndex === subjectIndex).length + 1,
    questionCount: questionsPerSubject(attempt.set, subjectIndex),
    workEndsAt: attempt.startedAt + minutesToMs(window.workEndsAt),
    closesAt: attempt.startedAt + minutesToMs(window.closesAt),
  };
}

/**
 * When the Attempt finished, if it has by time `at`: at its last Response when every Subject's
 * Questions were answered, otherwise when the last Subject's Window closed.
 */
export function finishedAt(attempt: Attempt, at: number): number | undefined {
  if (positionAt(attempt, at) !== "finished") return undefined;
  if (attempt.cursor === "finished") return attempt.responses.at(-1)!.submittedAt;
  return attempt.startedAt + minutesToMs(windowOf(attempt.set, attempt.set.subjects.length - 1).closesAt);
}

export interface Review {
  subjects: { subject: string; timedOut: boolean; difficultyPath: Difficulty[]; responses: ReviewedResponse[] }[];
}

export interface ReviewedResponse {
  question: Question;
  /** The order the Student saw the Options in: position on screen -> index into `question.options`. */
  optionOrder: number[];
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
            optionOrder: optionOrder(attempt, r.question),
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

/**
 * The order a Question's Options are shown in during this Attempt: shuffled, and the same every time.
 * It comes from the Attempt's seed and the Question's id, so it needs no saved state of its own.
 * Selections and Responses always use the Options' own indexes, never screen positions.
 */
export function optionOrder(attempt: Attempt, question: Question): number[] {
  const order = question.options.map((_, i) => i);
  if (attempt.optionSeed === undefined) return order;
  let state = (attempt.optionSeed ^ hashText(question.id)) >>> 0;
  const next = () => {
    // mulberry32: a small, well-mixed generator for 32-bit seeds.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** FNV-1a: turns a Question id into 32 bits for `optionOrder`. */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
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

function questionsPerSubject(set: ExerciseSet, subjectIndex: number): number {
  return set.subjects[subjectIndex]!.questionCount;
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
