"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WebsiteLogo } from "../icons/WebsiteLogo";

const EASE = [0.32, 0.72, 0, 1] as const;

const LINKS = [
  { href: "/competitions", label: "Competitions" },
  { href: "/projects", label: "Projects" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 mt-6 flex w-full justify-center px-4">
        <nav
          className={cn(
            "flex w-max items-center gap-1 rounded-full border border-border bg-card/80 px-2 py-2 backdrop-blur-xl transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
            "shadow-sm"
          )}
        >
          <Link
            href="/"
            className="rounded-full px-3 py-1.5 text-sm font-semibold tracking-tight text-foreground"
          >
            <WebsiteLogo className="mr-2 inline h-4 w-4" />
            Kizunia
          </Link>

          <div className="mx-1 hidden items-center gap-0.5 sm:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <Button asChild size="sm" className="ml-1 hidden rounded-full sm:inline-flex">
            <Link href="/competitions">Explore competitions</Link>
          </Button>

          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="relative ml-1 flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-300 hover:bg-muted sm:hidden"
          >
            <span className="relative block h-3.5 w-4">
              <span
                className={cn(
                  "absolute left-0 h-px w-4 bg-current transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  open ? "top-1/2 -translate-y-1/2 rotate-45" : "top-0"
                )}
              />
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current transition-opacity duration-300",
                  open ? "opacity-0" : "opacity-100"
                )}
              />
              <span
                className={cn(
                  "absolute left-0 h-px w-4 bg-current transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  open ? "top-1/2 -translate-y-1/2 -rotate-45" : "bottom-0"
                )}
              />
            </span>
          </button>
        </nav>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-background/95 backdrop-blur-3xl sm:hidden"
          >
            {LINKS.map((link, i) => (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, y: 48 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.05 }}
              >
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="px-4 py-3 text-2xl font-medium text-foreground"
                >
                  {link.label}
                </Link>
              </motion.div>
            ))}
            <motion.div
              initial={{ opacity: 0, y: 48 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.1 + LINKS.length * 0.05 }}
            >
              <Button asChild size="lg" className="mt-4 rounded-full">
                <Link href="/competitions" onClick={() => setOpen(false)}>
                  Explore competitions
                </Link>
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
