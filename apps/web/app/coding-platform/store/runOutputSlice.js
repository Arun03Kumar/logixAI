import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { SUBMISSION_API_URL } from "@/app/coding-platform/lib/config";
import { getClientUserId } from "@/app/coding-platform/lib/clientUserId";

async function postSubmission({ id, userCode, language }) {
  const res = await fetch(`${SUBMISSION_API_URL}/submission/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: getClientUserId(),
      problemId: id,
      code: userCode,
      language,
    }),
  });
  return res.json();
}

// Run and Submit both queue a submission today; the judge result arrives
// later over the socket (setRunOutput). Phase 2 separates them.
export const runCode = createAsyncThunk("runOutput/runCode", postSubmission);
export const submitCode = createAsyncThunk(
  "runOutput/submitCode",
  postSubmission,
);

function queued(state, action) {
  const body = action.payload;
  if (body?.success) {
    state.isJudging = true;
    state.submissionId = String(body.data?.submission?._id ?? "");
  } else {
    state.error = body?.message || "Couldn't submit your code";
  }
}

const runOutputSlice = createSlice({
  name: "runOutput",
  initialState: {
    /** Judge result event: { submissionId, status, response: [{status, output}] } */
    data: null,
    isRunning: false,
    isSubmitting: false,
    /** Queued, waiting for the verdict over the socket. */
    isJudging: false,
    submissionId: null,
    outputTab: "result",
    error: null,
  },
  reducers: {
    setOutputTab: (state, action) => {
      state.outputTab = action.payload;
    },
    setRunOutput: (state, action) => {
      const result = action.payload;
      // Ignore results for older submissions from this browser.
      if (state.submissionId && result?.submissionId !== state.submissionId) {
        return;
      }
      state.data = result;
      state.isJudging = false;
      state.outputTab = "result";
    },
    clearRunOutput: (state) => {
      state.data = null;
      state.error = null;
      state.isJudging = false;
      state.submissionId = null;
      state.outputTab = "result";
    },
  },
  extraReducers: (builder) => {
    const start = (flag) => (state) => {
      state[flag] = true;
      state.data = null;
      state.error = null;
      state.isJudging = false;
      state.submissionId = null;
    };
    const fail = (flag) => (state, action) => {
      state[flag] = false;
      state.error = action.error.message || "Couldn't reach the judge";
    };
    builder
      .addCase(runCode.pending, start("isRunning"))
      .addCase(runCode.fulfilled, (state, action) => {
        state.isRunning = false;
        queued(state, action);
      })
      .addCase(runCode.rejected, fail("isRunning"))
      .addCase(submitCode.pending, start("isSubmitting"))
      .addCase(submitCode.fulfilled, (state, action) => {
        state.isSubmitting = false;
        queued(state, action);
      })
      .addCase(submitCode.rejected, fail("isSubmitting"));
  },
});

export const { setOutputTab, setRunOutput, clearRunOutput } =
  runOutputSlice.actions;
export default runOutputSlice.reducer;
