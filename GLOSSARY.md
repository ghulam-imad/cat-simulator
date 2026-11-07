# CAT Simulator

A practice tool where a parent writes timed, multiple-choice exercises and a child works through them, so the two can review the results together afterwards.

## Content

**Exercise Set**:
A collection of Subjects that the Student practises in one sitting, identified by its folder name: a number (`007` is Exercise Set 7) or a name (`labsky`). Every Exercise Set is kept, even after the Parent writes a new one. Once an Exercise Set has been attempted, its Questions and Correct Options are never changed. Any such change makes a new Exercise Set.
_Avoid_: Pack, test, exam

**Subject**:
A topic area inside an Exercise Set, taken in a fixed order. It has its own Questions, Work Time, Lead and Lag.
_Avoid_: Section, topic

**Question**:
One multiple-choice item written by the parent. It has a Difficulty, exactly four Options, and one or more Correct Options.
_Avoid_: Item, problem

**Single-answer Question**:
A Question with exactly one Correct Option.

**Multi-answer Question**:
A Question with more than one Correct Option. The student is told to "pick all that apply" but not how many to pick.
_Avoid_: Multi-select, checkbox question

**Difficulty**:
How hard a Question is: High (worth 3 points), Medium (2 points) or Low (1 point).
_Avoid_: Level, tier

**Option**:
One answer choice shown for a Question.
_Avoid_: Choice, answer

**Correct Option**:
An Option the parent marked as right. A Question can have one or several Correct Options.
_Avoid_: Answer key, right answer

**Pool**:
All the Questions of one Difficulty within one Subject. A Subject has three Pools, High, Medium and Low, and each holds at least as many Questions as the Subject asks. Pools larger than that give every Attempt a different mix of Questions.
_Avoid_: Bank, bucket

**Work Time**:
The planned minutes for one Subject. The Subjects' Work Times run back to back on one shared clock that starts when the Student presses Start, and together they make up the Exercise Set's total time.
_Avoid_: Duration, time limit

**Lead**:
How many minutes before its Work Time a Subject opens, so a Student who finishes the previous Subject early can start it sooner. The first Subject has no Lead.
_Avoid_: Early start, grace

**Lag**:
How many minutes after its Work Time a Subject stays open for a Student who is running late. Time spent in Lag is taken from the next Subject. The last Subject has no Lag.
_Avoid_: Overtime, extension

**Window**:
The span of the shared clock when a Subject is open: from the start of its Lead to the end of its Lag. Neighbouring Windows overlap.
_Avoid_: Slot, period

## People

**Student**:
The child who practises. They are identified by name only, with no password.
_Avoid_: User, kid, player

**Parent**:
The adult who writes the Exercise Sets and reviews the Attempts with the Student.
_Avoid_: Admin, teacher

## Practice

**Attempt**:
One run of an Exercise Set by one Student, from start to finish. Its shared clock keeps running in real time even while the page is closed, and reopening the page resumes the Attempt. Retaking an Exercise Set creates a new Attempt, and every Attempt is kept.
_Avoid_: Session, test run, try

**Selected Subjects**:
The Subjects a Student chose to run in an Attempt, when they leave some of the Exercise Set's Subjects out. They keep the set's order and their own Work Time, Lead and Lag, except that the first has no Lead and the last has no Lag, and no Lead or Lag reaches past the neighbouring Subject's Work Time. An Attempt with every Subject has no Selected Subjects to mention.
_Avoid_: Custom run, partial set

**Interruption**:
A period during an Attempt when the Student's page was closed. The clock keeps running through it.
_Avoid_: Pause, break

**Adaptive Selection**:
The rule that picks each next Question. It starts with a random Low Question in every Subject, goes one Difficulty up after a correct Response, and goes one down after a wrong or missing one. Each Question comes from that Difficulty's Pool, and none is repeated within an Attempt.
_Avoid_: Branching, leveling

**Response**:
What the Student submitted for one Question. A Response is correct only if it picks every Correct Option and no other Option.
_Avoid_: Answer, submission

**Timed Out**:
The state of a Subject when its Window closed before all its Questions were answered. Every Question left unanswered scores 0.

**Difficulty Path**:
The sequence of Difficulties a Student was given across one Subject's Questions. It shows how Adaptive Selection moved them up and down.

**Score**:
The points the Student earned. A correct Response earns its Question's Difficulty points (3, 2 or 1), and anything else earns 0.
_Avoid_: Marks, grade
