import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeScript } from "@logixai/ui";
import "./globals.css";
import ReduxProvider from "./coding-platform/components/ReduxProvider";
import AppToaster from "./components/layout/AppToaster";
import { SessionBootstrap } from "./lib/auth/useSession";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LogixAI | Find Your X Factor",
  description:
    "LogixAI is an edtech platform founded by IITians: computer science courses, coding practice and proctored tests for schools and colleges.",
  keywords: [
    "edtech",
    "IITians",
    "coding practice",
    "computer science courses",
    "online exams",
    "LogixAI",
  ],
  openGraph: {
    title: "LogixAI | Find Your X Factor",
    description: "Learn with IITians. Find the logic behind every why.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${jetbrains.variable} scroll-smooth`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
        {/* API URLs from the server's environment; must run before the app's scripts. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <SessionBootstrap />
        <ReduxProvider>{children}</ReduxProvider>
        <AppToaster />
      </body>
    </html>
  );
}
