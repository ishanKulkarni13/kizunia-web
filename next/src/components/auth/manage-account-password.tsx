"use client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DialogHeader } from "../ui/dialog";
import { ArrowDownRightSquareIcon } from "lucide-react";
import z from "zod";
import { passwordSchema } from "@/lib/validation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoadingButton } from "../ui/loading-button";

import { PasswordInput } from "../ui/password-input";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import Link from "next/link";

export default function ManageAccountPassword() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Passwoed</CardTitle>
        <CardDescription>Change or reset your password</CardDescription>
      </CardHeader>
      <CardContent>
       <div className="flex justify-start items-center gap-1" >
         <ChangePassword />
        <Button asChild>
          <Link href="/forgot-password">Forgot Password</Link>
        </Button>
       </div>
      </CardContent>
    </Card>
  );
}

const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, { message: "Enter you current Passowrd" }),
    newPassword: passwordSchema,
    passwordConfirmation: z
      .string()
      .min(1, { message: "Please confirm password" }),
    revokeOtherSessions: z.boolean(),
  })
  .refine((data) => data.newPassword === data.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });
type ChangePasswordValues = z.infer<typeof ChangePasswordSchema>;

function ChangePassword() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      passwordConfirmation: "",
      revokeOtherSessions: false,
    },
  });

  async function onSubmit(values: ChangePasswordValues) {
    await authClient.changePassword(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: values.revokeOtherSessions,
      },
      {
        onRequest() {
          setLoading(true);
          setError(null);
        },
        onResponse() {
          setLoading(false);
        },
        onError(context) {
          // let message: string | undefined;
          // const errorCode = context.error?.code as ErrorCode
          // if(errorCode && errorCode == "INVALID_PASSWORD"){
          //   message = wrong password
          // }

          setError(context.error.message);
          toast.error(context.error.message, { id: "change-pass" });
        },
        onSuccess() {
          toast.success("Successfully changes the password");
          setDialogOpen(false);
          form.reset();
        },
      }
    );
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowDownRightSquareIcon /> Change Pass
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>
            Change the password for you account
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name={"currentPassword"}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="Current password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name={"newPassword"}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder="New password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name={"passwordConfirmation"}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Conform New Password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="new-password"
                      placeholder="New password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}

            <LoadingButton type="submit" className="w-full" loading={loading}>
              Conform Change Password
            </LoadingButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
