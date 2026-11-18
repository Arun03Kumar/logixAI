/** Pro right now? The session's plan can lapse while the page is open. */
export function isPro(user, now = Date.now()) {
  return user?.plan?.tier === "pro" && Boolean(user.plan.until) && new Date(user.plan.until).getTime() > now;
}

/** 39900 paise -> "₹399"; 9950 -> "₹99.50". Prices from the server are in paise. */
export function formatRupees(paise) {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const formatDay = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
