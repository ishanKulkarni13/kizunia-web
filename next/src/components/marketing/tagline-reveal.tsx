import { WordReveal } from "@/components/marketing/word-reveal";

export function TaglineReveal() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-28 text-center sm:py-36">
      <WordReveal
        text="There are opportunities everywhere. Finding the ones that matter to you shouldn't mean searching everywhere too."
        className="max-w-170 text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl"
      />
    </section>
  );
}
