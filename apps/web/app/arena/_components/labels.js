// Shared labels for ML Arena screens.

export const ITEM_TYPE = {
  mcq_single: "Single choice",
  mcq_multi: "Multiple choice",
  numeric: "Numeric",
  output: "Predict the output",
  code: "Code",
  debug: "Debug",
};

export const TRACK_LEVEL = {
  foundations: { label: "Foundations", tone: "info" },
  core: { label: "Core", tone: "brand" },
  interview: { label: "Interview", tone: "warning" },
};

export const isCodeItem = (type) => type === "code" || type === "debug";

export const pct = (fraction) => `${Math.round((fraction ?? 0) * 100)}%`;

export const LABS = [
  {
    href: "/arena/lab/gradient-descent",
    title: "Gradient descent",
    description: "Change the learning rate and watch the path to the minimum converge, zig-zag or blow up.",
  },
  {
    href: "/arena/lab/linear-regression",
    title: "Linear regression",
    description: "Fit a line by hand, then by gradient descent, and see how the loss responds.",
  },
  {
    href: "/arena/lab/logistic-regression",
    title: "Decision boundaries",
    description: "Train logistic regression on 2-D data and see why a straight line can't separate every shape.",
  },
  {
    href: "/arena/lab/k-means",
    title: "K-means clustering",
    description: "Step through assign-and-update, try different k, and read the elbow chart.",
  },
];
