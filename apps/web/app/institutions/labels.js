export const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  instructor: "Instructor",
  student: "Student",
};

export const ROLE_TONE = {
  owner: "brand",
  admin: "info",
  instructor: "neutral",
  student: "outline",
};

export const TYPE_LABEL = {
  school: "School",
  college: "College",
  university: "University",
  coaching: "Coaching institute",
  other: "Other",
};

export const canManage = (role) => role === "owner" || role === "admin";
export const canView = (role) => canManage(role) || role === "instructor";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "—");
