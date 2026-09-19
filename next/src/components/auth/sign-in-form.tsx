"use client";

import { LoadingButton } from "@/components/ui/loading-button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import OAuthButtons from "./OAuthButtons";

const signInSchema = z.object({
  email: z.email({ message: "Please enter a valid email" }),
  password: z.string().min(1, { message: "Password is required" }),
  rememberMe: z.boolean().optional(),
});

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm() {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // const lastMethod = authClient.getLastUsedLoginMethod()

  const redirect = searchParams.get("redirect");

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: true,
    },
  });

  async function onSubmit({ email, password, rememberMe }: SignInValues) {
    await authClient.signIn.email(
      {
        email,
        password,
        rememberMe,
      },
      {
        onRequest() {
          setError(null);
          setLoading(true);
        },
        onResponse() {
          setLoading(false);
        },
        async onSuccess(context) {
          if (context.data.twoFactorRedirect) {
            // if 2fa is enabled
            toast.success("Verify TOTP", {
              id: "signin",
              description: "Redirecting to verify OTP",
            });
            router.push("/two-factor");
          } else {
            // if 2fa is not enabled
            // toast.success("Signed in successfully", {
            //   id: "signin",
            //   description: "Redirecting to dashboard",
            // });

            setLoading(true); // to indicate redirecting
            router.push(redirect ?? "/competitions");
          }
        },
      }
    );

    const { error } = await authClient.signIn.email(
      {
        email,
        password,
        rememberMe,
      },
      {
        async onSuccess() {},
      }
    );

    if (error) {
      setError(error.message || "Something went wrong");
    } else {
      toast.success("Signed in successfully", {
        id: "signin",
        description: "Redirecting...",
      });
      router.push(redirect ?? "/competitions");
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">Sign In</CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Enter your email below to login to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href={`/forgot-password${
                        form.getValues("email")
                          ? `?email=${form.getValues("email")}`
                          : ""
                      }`}
                      className="ml-auto inline-block text-sm underline"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel>Remember me</FormLabel>
                </FormItem>
              )}
            />

            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <LoadingButton type="submit" className="w-full" loading={isLoading} disabled={isLoading} >
              Sign in
            </LoadingButton>

            {/* <div className="flex w-full flex-col items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("google")}
              >
                <GoogleIcon width="0.98em" height="1em" />
                Sign in with Google
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={loading}
                onClick={() => handleSocialSignIn("github")}
              >
                <GitHubIcon />
                Sign in with Github
              </Button>
            </div> */}
            <OAuthButtons
              redirect={redirect ? redirect : undefined}
              isLoading={isLoading}
              setIsLoading={setLoading}
            />
          </form>
        </Form>
      </CardContent>
      <CardFooter>
        <div className="flex w-full justify-center">
          <p className="text-muted-foreground text-center text-xs">
            Don&apos;t have an account?{" "}
            <Link href="/sign-up" className="underline">
              Sign up
            </Link>
          </p>
        </div>
      </CardFooter>
    </Card>
  );
}
