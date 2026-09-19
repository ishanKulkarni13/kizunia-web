"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

const EASE = [0.32, 0.72, 0, 1] as const;

export function WordReveal({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const words = text.split(" ");

  return (
    <p ref={ref} className={className}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="inline-block"
          initial={{ opacity: 0.28 }}
          animate={inView ? { opacity: 1 } : { opacity: 0.28 }}
          transition={{
            duration: 0.6,
            ease: EASE,
            delay: i * 0.045,
          }}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </p>
  );
}
