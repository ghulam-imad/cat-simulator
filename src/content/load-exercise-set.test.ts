import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadExerciseSet } from "./load-exercise-set.js";

/** Writes an Exercise Set folder named `folderName` containing the given files, and returns its path. */
function setFolder(folderName: string, files: Record<string, string>): string {
  const folder = join(mkdtempSync(join(tmpdir(), "cat-sets-")), folderName);
  mkdirSync(folder);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(folder, name), content);
  return folder;
}

const md = (strings: TemplateStringsArray, ...values: unknown[]) =>
  String.raw({ raw: strings }, ...values).replace(/^\n/, "");

/** A valid Subject file with one Question in each Pool. */
function subjectFile(name: string, times: string): string {
  const question = (difficulty: string) => `## difficulty: ${difficulty}\nQuestion?\n\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n`;
  return `# ${name}\n${times}\n\n${["high", "medium", "low"].map(question).join("\n")}`;
}

describe("loading an Exercise Set", () => {
  test("reads a Subject's name, times and Questions from its Markdown file", () => {
    const folder = setFolder("007", {
      "1-math.md": md`
# Math
work: 20 min
lag: 5 min

## difficulty: high
What is 12 × 12?

- [ ] 124
- [x] 144
- [ ] 142
- [ ] 1212

## difficulty: medium
What is 2 + 2?

- [ ] 3
- [x] 4
- [ ] 5
- [ ] 22

## difficulty: low
What is 1 + 1?

- [x] 2
- [ ] 3
- [ ] 11
- [ ] 0
`,
      "2-english.md": subjectFile("English", "work: 10 min\nlead: 5 min"),
    });

    const result = loadExerciseSet(folder);

    expect(result).toMatchObject({ ok: true, set: { number: "7" } });
    const math = result.ok ? result.set.subjects[0] : undefined;
    expect(math).toMatchObject({ name: "Math", workMinutes: 20, leadMinutes: 0, lagMinutes: 5 });
    expect(math?.questions[1]).toEqual({
      id: "1-math.md#2",
      difficulty: "medium",
      text: "What is 2 + 2?",
      options: ["3", "4", "5", "22"],
      correctOptions: [1],
    });
  });

  test("puts Subjects in the order of the number in front of their file names", () => {
    const folder = setFolder("8", {
      "2-english.md": subjectFile("English", "work: 10 min\nlead: 5 min\nlag: 5 min"),
      "10-science.md": subjectFile("Science", "work: 10 min\nlead: 5 min"),
      "1-math.md": subjectFile("Math", "work: 20 min\nlag: 5 min"),
    });

    const result = loadExerciseSet(folder);

    expect(result.ok && result.set.subjects.map((s) => s.name)).toEqual(["Math", "English", "Science"]);
  });
});

describe("refusing a broken Exercise Set", () => {
  test("every Question needs exactly 4 Options", () => {
    const threeOptions = subjectFile("Math", "work: 20 min").replace("- [ ] d\n", "");
    const folder = setFolder("9", { "1-math.md": threeOptions });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: ["1-math.md, Question 1: has 3 Options, but every Question needs exactly 4."],
    });
  });

  test("every Question needs at least one Correct Option", () => {
    const noneMarked = subjectFile("Math", "work: 20 min").replace("- [x] a", "- [ ] a");
    const folder = setFolder("9", { "1-math.md": noneMarked });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: ["1-math.md, Question 1: no Option is marked [x] as correct."],
    });
  });

  test("the Difficulty must be high, medium or low", () => {
    const typo = subjectFile("Math", "work: 20 min").replace("difficulty: medium", "difficulty: meduim");
    const folder = setFolder("9", { "1-math.md": typo });

    expect(loadExerciseSet(folder)).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([
        '1-math.md, Question 2: difficulty "meduim" should be high, medium or low.',
      ]),
    });
  });

  test("a Subject's three Pools must hold the same number of Questions", () => {
    const extraHigh = subjectFile("Math", "work: 20 min") + "\n## difficulty: high\nAnother?\n\n- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n";
    const folder = setFolder("9", { "1-math.md": extraHigh });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: ["1-math.md: the Pools must be the same size, but there are 2 High, 1 Medium and 1 Low Questions."],
    });
  });

  test("every Subject needs a Work Time", () => {
    const folder = setFolder("9", { "1-math.md": subjectFile("Math", "lag: 0 min") });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: ["1-math.md: needs a Work Time line, e.g. \"work: 20 min\"."],
    });
  });

  test("the first Subject has no Lead and the last Subject has no Lag", () => {
    const folder = setFolder("9", {
      "1-math.md": subjectFile("Math", "work: 20 min\nlead: 5 min"),
      "2-english.md": subjectFile("English", "work: 10 min\nlag: 5 min"),
    });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: [
        "1-math.md: the first Subject can't have a Lead, because nothing comes before it.",
        "2-english.md: the last Subject can't have a Lag, because nothing comes after it.",
      ],
    });
  });

  test("a Lead or Lag can't reach past the neighbouring Subject's Work Time", () => {
    const folder = setFolder("9", {
      "1-math.md": subjectFile("Math", "work: 20 min\nlag: 15 min"),
      "2-english.md": subjectFile("English", "work: 10 min\nlead: 25 min"),
    });

    expect(loadExerciseSet(folder)).toEqual({
      ok: false,
      problems: [
        "1-math.md: Lag 15 min is longer than the next Subject's Work Time (10 min).",
        "2-english.md: Lead 25 min is longer than the previous Subject's Work Time (20 min).",
      ],
    });
  });

  test("a Subject needs at least one Question", () => {
    const folder = setFolder("9", { "1-math.md": "# Math\nwork: 20 min\n" });

    expect(loadExerciseSet(folder)).toEqual({ ok: false, problems: ["1-math.md: has no Questions."] });
  });

  test("an Exercise Set needs at least one Subject file", () => {
    const folder = setFolder("9", { "notes.txt": "nothing here" });

    expect(loadExerciseSet(folder)).toEqual({ ok: false, problems: ["The folder has no Subject (.md) files."] });
  });
});
