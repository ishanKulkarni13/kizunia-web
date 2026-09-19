import { useEffect } from "react";
import { GitHubIcon } from "../icons/GitHubIcon";
import { GoogleIcon } from "../icons/GoogleIcon";
import { Button } from "../ui/button";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "../ui/badge";

export interface OAuthButtonsProps {
  isLoading?: boolean;
  setIsLoading?: (val: boolean) => void;
  redirect?: string;
}

export default function OAuthButtons({
  redirect,
  isLoading,
  setIsLoading,
}: OAuthButtonsProps) {
  const router = useRouter();
  // const lastMethod = authClient.getLastUsedLoginMethod();

  async function handleSocialSignIn(provider: "google" | "github") {
    if (setIsLoading) {
      setIsLoading(false);
    }

    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: redirect ?? "/",
      // errorCallbackURL: "/auth/error", // TODO: implement error callback url
      // fetchOptions:{
      // onRequest: ()=>{},
      // onResponse: ()=>{},
      // onError: ()=>{},
      // onSuccess: ()=>{},
      // }
    });

    if (setIsLoading) {
      setIsLoading(false);
    }

    if (error) {
      toast.error(error.message || "Something went wrong", { id: "oauth" });
    }
  }

  return (
    <div className="flex w-full flex-col items-center justify-between gap-2">
      {/* <Button
        type="button"
        variant="outline"
        className="w-full gap-2 relative "
        disabled={isLoading}
        onClick={() => handleSocialSignIn("google")}
      >
        <GoogleIcon width="0.98em" height="1em" />
        <span> Sign in with Google </span>
      </Button> */}

      <Button
        type="button"
        variant="outline"
        className="w-full flex gap-2 relative"
        disabled={isLoading}
        onClick={() => handleSocialSignIn("github")}
      >
        <GitHubIcon />
        <span> Sign in with Github </span>
      </Button>
    </div>
  );
}
