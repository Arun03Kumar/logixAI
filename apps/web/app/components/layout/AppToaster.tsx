"use client";

import { Toaster } from "react-hot-toast";

/** Global toast host, styled with the design tokens. */
export default function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          fontSize: "14px",
          boxShadow: "0 8px 24px rgb(0 0 0 / 0.08)",
        },
        success: { iconTheme: { primary: "var(--success)", secondary: "var(--card)" } },
        error: { iconTheme: { primary: "var(--danger)", secondary: "var(--card)" } },
      }}
    />
  );
}
