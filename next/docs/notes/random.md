For TypeScript error checking only (recommended while developing):

pnpm exec tsc --noEmit

Or, to continuously watch for errors:

pnpm exec tsc --noEmit --watch
If you also want ESLint:
pnpm lint
Quick comparison
Command	Purpose
pnpm exec tsc --noEmit	✅ TypeScript type checking only (fast)
pnpm exec tsc --noEmit --watch	✅ Continuous type checking while coding
pnpm lint	✅ ESLint checks
pnpm build	✅ Full production build (slow: type check + bundle + Next.js build)