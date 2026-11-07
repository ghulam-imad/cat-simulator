export type Difficulty = "high" | "medium" | "low";

export interface Question {
  id: string;
  difficulty: Difficulty;
  /** Markdown, may contain images and $LaTeX$. */
  text: string;
  /** Exactly four Options, in the order the Parent wrote them. */
  options: string[];
  /** Indexes into `options`. More than one makes it a Multi-answer Question. */
  correctOptions: number[];
}

export interface Subject {
  name: string;
  workMinutes: number;
  leadMinutes: number;
  lagMinutes: number;
  /** How many Questions the Student is given. Each Pool holds at least this many. */
  questionCount: number;
  questions: Question[];
}

export interface ExerciseSet {
  number: string;
  subjects: Subject[];
}
