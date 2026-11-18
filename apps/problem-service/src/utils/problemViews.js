const { splitTests } = require("@logixai/contracts");

const plain = (doc) => (typeof doc?.toObject === "function" ? doc.toObject() : doc);

/**
 * What students may see: the statement, sample tests and starter code.
 * Hidden tests and the hidden code around the student's code stay private.
 */
function toPublicProblem(doc) {
  const p = plain(doc);
  const { samples, hidden } = splitTests(p);
  return {
    _id: String(p._id),
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    sampleTestCases: samples.map(({ input, output }) => ({ input, output })),
    hiddenTestCount: hidden.length,
    codeStubs: (p.codeStubs ?? []).map((s) => ({
      language: s.language,
      userSnippet: s.userSnippet ?? "",
    })),
  };
}

/** List entry: no tests or code at all. */
function toProblemSummary(doc) {
  const p = plain(doc);
  return {
    _id: String(p._id),
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
  };
}

/** Everything the judge needs (internal callers and admins only). */
function toJudgeProblem(doc) {
  const p = plain(doc);
  const { samples, hidden } = splitTests(p);
  return {
    _id: String(p._id),
    title: p.title,
    sampleTestCases: samples.map(({ input, output }) => ({ input, output })),
    hiddenTestCases: hidden.map(({ input, output }) => ({ input, output })),
    codeStubs: (p.codeStubs ?? []).map((s) => ({
      language: s.language,
      startSnippet: s.startSnippet ?? "",
      userSnippet: s.userSnippet ?? "",
      endSnippet: s.endSnippet ?? "",
    })),
  };
}

module.exports = { toPublicProblem, toProblemSummary, toJudgeProblem };
