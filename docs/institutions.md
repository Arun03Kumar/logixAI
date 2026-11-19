# Institutions

Schools, colleges, universities and coaching institutes use LogixAI as an
institution: their staff run tests and assign practice, and their students
take them. This page covers how institutions are set up and who can do what
(phase I1), how people get in (phase I2) and what tests can do (phase I3).
Reports and add-ons follow in phases I4–I5.

## Setting one up (platform admins)

Only LogixAI creates institutions. Platform admins (users with the `admin`
role, see `BOOTSTRAP_ADMIN_EMAILS`) use the **institutions console** at
`/admin/institutions` (user menu > Institutions console).

- **New institution**: name, type, 1–5 owner emails, departments (suggested
  per type), features and, optionally, a contract. Owners who already have an
  account become owners at once. The others get a one-time **owner code**
  (valid 30 days) to share with them; it appears under Owners until it's used.
- **Overview**: students against seats, staff, members active in the last 7
  days, people per role, the contract.
- **Settings**: name, type, email domains and status. *Suspended* and *archived*
  institutions are closed to their members (403) and their members lose the
  institution's Pro. Reactivate to undo.
- **Features**: switches per institution. Defaults depend on the type. Today
  `exams`, `arena`, `proctoring`, `rollNumberLogin` and `domainJoin` take
  effect; the others are for later phases and are recorded now so contracts
  can list them.
- **Contract**: per-seat (price per student per year, seats bought) or flat
  (price for the term, optional student limit), with dates and private notes.
  While it runs every member has Pro, and students can't join beyond the seats.
- **Owners**: add another owner by email.
- **Open as support**: opens the institution page with owner access. Each
  visit is recorded in the institution's audit log as
  `institution.support_access` (at most once an hour per admin).

API: `GET|POST /api/v1/admin/institutions`, `GET|PATCH /admin/institutions/:id`,
`PUT /admin/institutions/:id/features`, `PUT /admin/institutions/:id/contract`
(body: the contract, or `{ "contract": null }`), `POST /admin/institutions/:id/owners`.

## Roles

| Role | Can | Acts on |
| --- | --- | --- |
| Owner | everything, including other owners | the whole institution |
| Admin | everything except ownership | the whole institution |
| Department head | departments' batches, people, tests, grading, practice, reports | batches in their departments, plus their own |
| Instructor | tests, grading, practice, reports | their batches |
| Assistant | grading, reports | their batches |
| Student | takes tests and practice | their batches |

Capabilities (`CAPABILITIES` in `@logixai/contracts`): `institution.manage`,
`structure.manage`, `people.manage`, `tests.manage`, `tests.grade`,
`practice.assign`, `reports.view`, `audit.view`. People can only give roles
below their own (owners can give any role). Owners can't be invited by the
institution; LogixAI adds them.

`GET /api/v1/institutions/:id` returns the caller's membership with
`access: { role, capabilities, scope: { all, batchIds, departmentIds }, support }`
and the institution's `status` and `features`. exam-service and arena-service
use it (through the caller's own token) to decide what the caller may do:

- exams: `tests.manage` to write and publish, `reports.view` for results.
  Staff without `scope.all` see only exams for their batches (or ones they
  created) and must target at least one of their batches. With `proctoring`
  off, fullscreen and copy/paste blocking are saved as off.
- ML Arena: `practice.assign` to assign tracks, `reports.view` for batch
  reports, both only on batches in scope.
- Either is closed with a 403 when its feature is off.

## Structure

- **Departments** (owners and admins): name and optional code. A department
  with batches can't be deleted.
- **Batches**: name, department, academic year (`2026` or `2026-27`).
  Archived batches stay in reports but take no new invites or tests.
- Department heads are assigned their departments on the Members tab.

## Getting people in (phase I2)

Staff with `people.manage` (owners, admins, department heads in their
batches) have these on the institution page:

- **Import students** (Members tab): a CSV or cells pasted from a
  spreadsheet with *Name, Roll number, Email, Batch* (header names like
  "Roll No", "Class" and "Section" are recognised). Each row needs a roll
  number or an email. **Check** shows what each row will do without
  changing anything; **Import** applies it:
  - someone with a LogixAI account (same email) joins with it;
  - everyone else gets a new account with a temporary password (shown once,
    in the downloadable *sign-in sheet*) and must pick their own password at
    first sign-in;
  - existing students get the row's batch and roll number added;
  - repeated roll numbers or emails, unknown or archived batches and rows
    beyond the contract's seats are reported and skipped.
  Owners and admins can let the import create the batches the file names.
  Department heads can only import into their own batches. Up to 500 rows per
  request; the page sends bigger files in parts (5,000 rows at most).
- **Roll numbers**: unique per institution (case doesn't matter, stored
  upper-case), shown and editable on the Members tab, asked for (optionally)
  when a student joins with an invite. With `rollNumberLogin` on, any member
  with a roll number can sign in at `/login` > *Roll number* with the
  **institution code** (the institution's slug, shown to staff under its
  name) and their password. `/login?institution=<code>` pre-fills the code.
- **Temporary passwords**: staff can give a new one to accounts the
  institution created (the key icon on the Members tab); it signs the person
  out everywhere. People who made their own account change their own password
  (user menu > *Change password*). Email-based reset needs an email provider
  and isn't built yet.
- **Approvals**: an invite can require approval. People who use it wait in
  the **Requests** tab (the invite's use is taken when they ask). Approving
  creates the membership (seats are checked then); turning down leaves them
  out. Each person has at most one waiting request per institution.
- **Email domains**: the platform admin sets domains (Settings, e.g.
  `abc.edu.in`; webmail domains are refused) and switches on `domainJoin`.
  Signed-in people whose email has that domain see the institution on
  `/institutions` and can ask to join as a student. Because email addresses
  aren't verified yet, every domain request goes through approval, and the
  approver picks the batch.
- **QR codes**: every active invite has a QR code (Invites tab) to show on a
  projector, print as a poster or download as an image. It opens
  `/join/<code>`.
- **Year rollover** (Batches tab, arrow icon): moves a batch's students into
  a new batch (name and year suggested, same department) or an existing one,
  and archives the old batch by default. Staff memberships don't move; past
  tests and reports keep the old batch. To graduate a class, archive its
  batch: students whose batches are all archived don't use seats.

API (all under `/api/v1`):

| Route | Who |
| --- | --- |
| `POST /auth/login/roll-number` `{ institution, rollNumber, password }` | anyone |
| `POST /auth/password` `{ currentPassword, newPassword }` | signed in; returns a new session, other sessions end |
| `POST /institutions/:id/import` `{ rows, batchId, createBatches, dryRun }` | `people.manage` |
| `POST /institutions/:id/members/:userId/password` | `people.manage`, accounts the institution created |
| `PATCH /institutions/:id/members/:userId` `{ rollNumber }` | `people.manage` |
| `GET /institutions/:id/join-requests?status=pending` | `people.manage` |
| `POST /institutions/:id/join-requests/:requestId/decision` `{ approve, batchId? }` | `people.manage` |
| `GET /institutions/suggested` | signed in |
| `POST /institutions/:id/join-requests` `{ rollNumber? }` | signed in, matching email domain |
| `POST /institutions/:id/batches/:batchId/promote` `{ toBatchId \| newBatch, archiveSource }` | `structure.manage` |
| `POST /invites/:code/accept` `{ rollNumber? }` | signed in; 202 `{ pending: true }` when approval is needed |

## Tests in depth (phase I3)

All in exam-service. Each one is a choice made per exam (or per question), so
institutions use what suits them.

- **Written answers** (`short_answer`, `long_answer`; needs the `subjective`
  feature, on by default for schools, colleges and universities). Each has
  an optional model answer, a rubric (points with marks; they may not add up
  to more than the question) and a word limit shown to students. Blank
  answers score 0 straight away; the rest wait for a grader, so the attempt
  total stays empty until every written answer has marks.
- **Grading** (`tests.grade`: department heads, instructors, assistants, in
  their batches): the exam's **Grade** page lists each written question with
  progress and a queue of answers, oldest first. Ticking rubric points fills
  in the marks, which can still be changed; an optional comment goes to the
  student. "Hide names" helps blind marking. From a student's attempt page a
  grader can also override any question's automatic score (and go back to
  it). Every grade is in the audit log (who, which question, old and new
  marks; never the answer or comment).
- **Negative marking**: per MCQ (`negativeMarks`). A wrong answer loses that
  much, a blank one nothing; the total can go below 0. The editor can apply
  one value to every MCQ.
- **Sections**: titled parts with instructions. Students see questions
  grouped by section (questions without one come first); shuffling stays
  inside a section; results show a subtotal per section.
- **Extra time** (`tests.manage`, any time, even mid-exam): minutes for one
  student, added to their duration and to the closing time. A student who
  is writing gets the new deadline at once. "Results after the exam closes"
  waits for the last student with extra time.
- **Rank** (`showRank`): with released results, students see their rank
  (equal scores share one), out of how many, and the percentile (share of
  the others who scored lower).
- **Re-evaluation** (`reevaluationDays`, 0 = off): once results are
  released and until N days after the exam is over, a student can ask for
  one re-check per question with a reason. Graders see the requests on the
  Grade page, reply, and may give new marks; the student sees the reply and
  the before/after score.
- **Question bank** (institution page > *Question bank*, for `tests.manage`):
  shared by everyone who sets exams. Save a question from the editor (book
  icon) with a topic, tags and difficulty; search and add from *From question
  bank*. Exams get a copy, so editing the bank never changes an exam. The
  author or an admin can change or remove a bank question.

API (exam-service, under `/api/v1`):

| Route | Who |
| --- | --- |
| `GET /exams/:id/grading` | `tests.grade` |
| `GET /exams/:id/grading/:questionId?show=ungraded\|all&limit=&cursor=` | `tests.grade` |
| `PUT /exams/:id/attempts/:attemptId/grades/:questionId` `{ marks \| null, rubricIds, comment }` | `tests.grade`; finished attempts |
| `PUT /exams/:id/extra-time` `{ userId, minutes }` | `tests.manage` |
| `GET /exams/:id/reevaluations?status=open\|resolved` | `tests.grade` |
| `POST /exams/:id/reevaluations/:requestId/resolve` `{ response, marks? }` | `tests.grade` |
| `POST /exams/:id/my-result/reevaluations` `{ questionId, reason }` | the student, while the window is open |
| `GET /institutions/:id/question-bank?q=&tag=&type=&difficulty=&limit=&cursor=` | `tests.manage` |
| `POST /institutions/:id/question-bank` `{ question, topic, tags, difficulty }` | `tests.manage` |
| `PUT` / `DELETE /institutions/:id/question-bank/:bankId` | the author, or institution-wide staff |

## Data

exam-service, `logixai-exams`: `exams` gain `sections` and `extraTime`
(userId → minutes) and settings `showRank`, `reevaluationDays`; `attempts`
gain `grades` (questionId → marks, rubricIds, comment, gradedBy, gradedAt);
new `reevaluation_requests` (one per attempt and question) and
`bank_questions`. Old documents work as they are (missing fields read as
empty), so no migration is needed; run `db:migrate` to build the new
indexes.

identity-service, `logixai-identity`: `institutions` (status, features,
contract, licenceUntil, licenceSeats, emailDomains), `memberships` (role,
batchIds, departmentIds, rollNumber — unique per institution), `departments`,
`batches` (departmentId, academicYear, archivedAt), `invites` (owner invites
carry the owner's email; requiresApproval), `join_requests` (pending,
approved or rejected; one pending per person per institution), `users`
(lastSeenAt for activity; email may be empty for roll-number accounts,
managedBy = the institution that created the account, mustChangePassword).
Migrations `2026-11-19-01-six-roles` and `2026-11-19-02-optional-email`
(the email index becomes unique only for real emails) bring existing data up
to date.
