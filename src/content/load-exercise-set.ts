import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Difficulty, ExerciseSet, Question, Subject } from "../engine/exercise-set.js";

export type LoadResult = { ok: true; set: ExerciseSet } | { ok: false; problems: string[] };

/** Reads the Exercise Set in `folder` (e.g. `sets/007`): one Markdown file per Subject. */
export function loadExerciseSet(folder: string): LoadResult {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => parseInt(a) - parseInt(b));
  if (files.length === 0) return { ok: false, problems: ["The folder has no Subject (.md) files."] };
  const subjects = files.map((file) => parseSubject(file, readFileSync(join(folder, file), "utf8")));
  const problems = subjects.flatMap((subject, i) => [
    ...subjectProblems(files[i]!, subject),
    ...timingProblems(files[i]!, subjects, i),
  ]);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, set: { number: setName(basename(folder)), subjects } };
}

/** Lead and Lag that don't fit with the neighbouring Subjects. */
function timingProblems(file: string, subjects: Subject[], i: number): string[] {
  const subject = subjects[i]!;
  const problems: string[] = [];
  if (i === 0 && subject.leadMinutes > 0) {
    problems.push(`${file}: the first Subject can't have a Lead, because nothing comes before it.`);
  }
  if (i === subjects.length - 1 && subject.lagMinutes > 0) {
    problems.push(`${file}: the last Subject can't have a Lag, because nothing comes after it.`);
  }
  const previous = subjects[i - 1];
  if (previous && subject.leadMinutes > previous.workMinutes) {
    problems.push(
      `${file}: Lead ${subject.leadMinutes} min is longer than the previous Subject's Work Time (${previous.workMinutes} min).`,
    );
  }
  const next = subjects[i + 1];
  if (next && subject.lagMinutes > next.workMinutes) {
    problems.push(`${file}: Lag ${subject.lagMinutes} min is longer than the next Subject's Work Time (${next.workMinutes} min).`);
  }
  return problems;
}

/** Mistakes in one Subject file, each phrased so the Parent can find and fix it. */
function subjectProblems(file: string, subject: Subject): string[] {
  const problems = subject.questions.flatMap((question, i) => {
    const where = `${file}, Question ${i + 1}`;
    const problems: string[] = [];
    if (question.options.length !== 4) {
      problems.push(`${where}: has ${question.options.length} Options, but every Question needs exactly 4.`);
    }
    if (!["high", "medium", "low"].includes(question.difficulty)) {
      problems.push(`${where}: difficulty "${question.difficulty}" should be high, medium or low.`);
    }
    if (question.correctOptions.length === 0) problems.push(`${where}: no Option is marked [x] as correct.`);
    return problems;
  });
  if (subject.questions.length === 0) return [`${file}: has no Questions.`];
  if (!(subject.workMinutes > 0)) problems.push(`${file}: needs a Work Time line, e.g. "work: 20 min".`);
  const count = (d: Difficulty) => subject.questions.filter((q) => q.difficulty === d).length;
  const [high, medium, low] = [count("high"), count("medium"), count("low")];
  if (high !== medium || medium !== low) {
    problems.push(
      `${file}: the Pools must be the same size, but there are ${high} High, ${medium} Medium and ${low} Low Questions.`,
    );
  }
  return problems;
}

const OPTION = /^- \[( |x|X)\] (.*)$/;

function parseSubject(file: string, content: string): Subject {
  const [header = "", ...blocks] = content.split(/^## /m);
  const name = /^# (.+)$/m.exec(header)?.[1]?.trim() ?? "";
  const minutes = (key: string) => Number(new RegExp(`^${key}:\\s*(\\d+)\\s*min`, "m").exec(header)?.[1] ?? 0);
  return {
    name,
    workMinutes: minutes("work"),
    leadMinutes: minutes("lead"),
    lagMinutes: minutes("lag"),
    questions: blocks.map((block, i) => parseQuestion(`${file}#${i + 1}`, block)),
  };
}

function parseQuestion(id: string, block: string): Question {
  const [heading = "", ...lines] = block.split("\n");
  const difficulty = /difficulty:\s*(\w+)/.exec(heading)?.[1] as Difficulty;
  const firstOption = lines.findIndex((l) => OPTION.test(l));
  const optionMatches = lines
    .slice(firstOption)
    .map((l) => OPTION.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return {
    id,
    difficulty,
    text: lines.slice(0, firstOption).join("\n").trim(),
    options: optionMatches.map((m) => m[2]!),
    correctOptions: optionMatches.flatMap((m, i) => (m[1] === " " ? [] : [i])),
  };
}

/** A numbered folder like `007` is Exercise Set `7`; any other folder name, like `labsky-001`, is used as is. */
export function setName(folderName: string): string {
  return /^\d+$/.test(folderName) ? String(Number(folderName)) : folderName;
}
