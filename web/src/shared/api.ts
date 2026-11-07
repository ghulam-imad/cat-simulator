/** Shapes of the server's replies, and small fetch helpers. */

export type Difficulty = "high" | "medium" | "low";

export type StudentView =
  | {
      kind: "question";
      subject: string;
      question: { text: string; options: string[]; multiAnswer: boolean };
      selected: number[];
      questionNumber: number;
      questionCount: number;
      workEndsAt: number;
      closesAt: number;
    }
  | { kind: "waiting"; nextSubject: string; opensAt: number }
  | { kind: "finished"; subjects: { subject: string; score: number; correct: number; questions: number }[] };

export interface StudentReply {
  now: number;
  endsAt: number;
  view: StudentView;
  attemptId?: string;
  error?: string;
}

export interface SetSummary {
  setNumber: string;
  totalMinutes: number;
  subjects: { name: string; workMinutes: number; leadMinutes: number; lagMinutes: number; questionCount: number }[];
  /** The Student's unfinished Attempt at this set, and the Subjects it runs; `null` when there is none. */
  inProgress: { subjects: string[] } | null;
}

export interface AttemptListItem {
  attemptId: string;
  student: string;
  setNumber: string;
  startedAt: number;
  status: "in progress" | "finished";
  score: number;
  /** Subjects of the Exercise Set this Attempt left out; empty when it ran them all. */
  skippedSubjects: string[];
  subjects: { subject: string; score: number; correct: number }[];
}

export interface ReviewedResponse {
  question: { id: string; difficulty: Difficulty; text: string; options: string[]; correctOptions: number[] };
  /** The order the Student saw the Options in: position on screen -> index into `question.options`. */
  optionOrder: number[];
  selected: number[];
  submittedAt: number;
  correct: boolean;
  points: number;
  secondsSpent: number;
  inLag: boolean;
  selectionChanges: { selected: number[]; at: number }[];
}

export interface AttemptDetail {
  attemptId: string;
  student: string;
  setNumber: string;
  startedAt: number;
  skippedSubjects: string[];
  interruptions: { from: number; to: number; subject: string; questionNumber?: number }[];
  subjects: { subject: string; timedOut: boolean; difficultyPath: Difficulty[]; responses: ReviewedResponse[] }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(json.error ?? `Request failed (${res.status})`), res.status, json);
  return json as T;
}
