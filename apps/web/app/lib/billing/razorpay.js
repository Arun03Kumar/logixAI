/**
 * Razorpay Checkout in the browser. The script comes from Razorpay's CDN;
 * card and UPI details go straight to Razorpay, never through our servers.
 */
const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let loading = null;

function loadScript() {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the payment window. Check your connection and try again."));
    };
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Opens Checkout for a server-created order. Resolves with the signed result
 * to send to /billing/verify; rejects if the window is closed or the payment fails.
 */
export async function payWithRazorpay(session) {
  await loadScript();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: session.keyId,
      order_id: session.providerOrderId,
      amount: session.quote.totalPaise,
      currency: "INR",
      name: "LogixAI",
      description: session.description,
      prefill: session.prefill,
      // Razorpay wants a colour value: use the design token, not a hard-coded hex.
      theme: { color: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || undefined },
      handler: (res) =>
        resolve({
          providerPaymentId: res.razorpay_payment_id,
          signature: res.razorpay_signature,
        }),
      modal: { ondismiss: () => reject(Object.assign(new Error("Payment cancelled."), { cancelled: true })) },
    });
    rzp.on("payment.failed", (res) => reject(new Error(res?.error?.description || "The payment didn't go through.")));
    rzp.open();
  });
}
