"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CompassIcon } from "@phosphor-icons/react/dist/ssr/Compass";
import { Button } from "@/components/ui/button";

const EASE = [0.32, 0.72, 0, 1] as const;

export function Hero() {
  return (
    <section className="relative flex min-h-[92svh] w-full flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 18%, color-mix(in oklch, var(--primary), transparent 88%), transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-muted-foreground"
      >
        <CompassIcon className="size-3.5" weight="bold" />
        A discovery layer, not another host
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.08, ease: EASE }}
        className="max-w-170 text-balance bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-center text-4xl font-semibold leading-tight tracking-tight text-transparent sm:text-5xl md:text-6xl"
      >
        Find your next competition.
        <br />
        Don&apos;t miss it.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.18, ease: EASE }}
        className="mt-6 max-w-170 text-pretty text-center text-lg text-muted-foreground sm:text-xl"
      >
        Discover competitions in one place and stay updated on the
        opportunities you care about.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.28, ease: EASE }}
        className="mt-9 flex flex-col items-center gap-4"
      >
        <Button asChild size="lg" className="rounded-full px-6 text-base">
          <Link href="/competitions">Explore competitions</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          No organizer accounts. No spam. Just discovery.
        </p>
      </motion.div>
    </section>
  );
}
