import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@mdxeditor/editor/style.css";
import "./globals.css";
import "./mdx.css";
import NextTopLoader from "nextjs-toploader";
// import "@mdxeditor/editor/style.css";
import { ThemeProvider } from "@/providers/theme-provider";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "sonner";
import { SpeedInsights } from '@vercel/speed-insights/next';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kizunia",
  description: "Building cool stuff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <script
        async
        crossOrigin="anonymous"
        src="https://tweakcn.com/live-preview.min.js"
      />
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          // enableSystem
          disableTransitionOnChange
        >
          {children}
          <NextTopLoader
            color="var(--color-primary)"
            height={4}
            showSpinner={false}
          />
          <Toaster />
        </ThemeProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
