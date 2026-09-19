import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import DotBackground from "@/components/ui/aceternity/dot-background";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a new account",
};

export default function SignUp() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <Suspense fallback={<SignUpFormSkeleton />}>
        <div className="px-4 flex-1 mx-auto flex flex-col items-center justify-center max-w-md w-full h-screen">
          <SignUpForm />
        </div>
        <div className="fixed top-0 left-0 z-[-1] h-screen w-screen overflow-hidden">
          <DotBackground />{" "}
        </div>
      </Suspense>
    </main>
  );
}

function SignUpFormSkeleton() {
  return <Skeleton className="w-full max-w-md h-96 rounded-lg" />;
}
