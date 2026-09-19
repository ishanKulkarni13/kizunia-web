import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import DotBackground from "@/components/ui/aceternity/dot-background";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your account",
};

export default function SignIn() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <Suspense fallback={<SignInFormSkeleton />}>
        <div className="px-4 flex-1 mx-auto flex flex-col items-center justify-center max-w-md w-full h-screen">
          <SignInForm />
        </div>
        <div className="fixed top-0 left-0 z-[-1] h-screen w-screen overflow-hidden">
          <DotBackground />{" "}
        </div>
      </Suspense>
    </main>
  );
}

//skeltonW
function SignInFormSkeleton() {
  return <Skeleton className="w-full max-w-md h-100 rounded-lg" />;
}
