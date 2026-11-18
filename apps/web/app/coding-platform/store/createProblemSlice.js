import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { DEFAULT_LANGUAGE, LANGUAGE_IDS } from "@logixai/languages";
import { PROBLEM_API_URL } from "@/app/coding-platform/lib/config";
import { authFetch, readEnvelope } from "@/app/lib/auth/session";

// One empty stub per supported language (from the shared language registry).
const emptyCodeStubs = () =>
  Object.fromEntries(
    LANGUAGE_IDS.map((id) => [
      id,
      { startSnippet: "", endSnippet: "", userSnippet: "" },
    ]),
  );

// Publishing needs a platform admin's access token.
export const publishProblem = createAsyncThunk(
  "createProblem/publishProblem",
  async (payload, { rejectWithValue }) => {
    try {
      const res = await authFetch(`${PROBLEM_API_URL}/problems`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return await readEnvelope(res);
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const createProblemSlice = createSlice({
  name: "createProblem",
  initialState: {
    // UI State
    showEditor: false,
    activeTab: "description", // description | markdown | testcases | codestub
    isEditingTitle: false,
    isPublishing: false,

    // Problem Data
    title: "",
    description: "", // markdown content from BlockNote editor
    markdownText: "", // raw markdown text from textarea
    difficulty: "easy",
    testCases: [{ input: "", output: "", sample: true }],
    codeStubs: emptyCodeStubs(), // Pre-initialize supported languages
    currentCodeStubLanguage: DEFAULT_LANGUAGE, // Currently selected language for code stub editing

    // API State
    publishError: null,
    publishSuccess: false,
  },
  reducers: {
    // UI Actions
    setShowEditor: (state, action) => {
      state.showEditor = action.payload;
    },
    setActiveTab: (state, action) => {
      state.activeTab = action.payload;
    },
    setIsEditingTitle: (state, action) => {
      state.isEditingTitle = action.payload;
    },

    // Problem Data Actions
    setTitle: (state, action) => {
      state.title = action.payload;
    },
    setDescription: (state, action) => {
      state.description = action.payload;
    },
    setMarkdownText: (state, action) => {
      state.markdownText = action.payload;
    },
    setDifficulty: (state, action) => {
      state.difficulty = action.payload;
    },
    setTestCases: (state, action) => {
      state.testCases = action.payload;
    },
    setCodeStubs: (state, action) => {
      state.codeStubs = { ...state.codeStubs, ...action.payload };
    },
    setCurrentCodeStubLanguage: (state, action) => {
      state.currentCodeStubLanguage = action.payload;
    },
    updateCodeStubForLanguage: (state, action) => {
      const { language, codeStub } = action.payload;
      // Ensure the language key exists before updating
      if (!state.codeStubs[language]) {
        state.codeStubs[language] = {
          startSnippet: "",
          endSnippet: "",
          userSnippet: "",
        };
      }
      state.codeStubs[language] = { ...state.codeStubs[language], ...codeStub };
    },

    // Reset Actions
    resetForm: (state) => {
      state.title = "";
      state.description = "";
      state.markdownText = "";
      state.difficulty = "easy";
      state.testCases = [{ input: "", output: "", sample: true }];
      state.codeStubs = emptyCodeStubs();
      state.currentCodeStubLanguage = DEFAULT_LANGUAGE;
      state.publishSuccess = false;
      state.publishError = null;
    },
    clearPublishState: (state) => {
      state.publishError = null;
      state.publishSuccess = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(publishProblem.pending, (state) => {
        state.isPublishing = true;
        state.publishError = null;
        state.publishSuccess = false;
      })
      .addCase(publishProblem.fulfilled, (state, action) => {
        state.isPublishing = false;
        state.publishSuccess = true;
        // Optionally reset form on success
        // state.title = 'Title of Problem (double click to change)';
        // state.description = '';
        // etc...
      })
      .addCase(publishProblem.rejected, (state, action) => {
        state.isPublishing = false;
        state.publishError = action.payload;
      });
  },
});

export const {
  setShowEditor,
  setActiveTab,
  setIsEditingTitle,
  setTitle,
  setDescription,
  setMarkdownText,
  setDifficulty,
  setTestCases,
  setCodeStubs,
  setCurrentCodeStubLanguage,
  updateCodeStubForLanguage,
  resetForm,
  clearPublishState,
} = createProblemSlice.actions;

export default createProblemSlice.reducer;
