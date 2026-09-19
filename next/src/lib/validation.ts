import z from "zod";

export const passwordSchema = z
  .string()
  .min(1, { message: "Password is required" })
  .min(8, { message: "Password must be at least 8 characters" })
  .regex(/[^A-Za-z0-9]/, {
    message: "Password must contain at least one special character",
  });

export const emailSchema = z.email();

export const usernameSchema = z
  .string()
  .min(3, { message: "Username should be at least 3 characters long" })
  .max(30, { message: "Username should not be longer than 30 characters" })
  .regex(/^[a-zA-Z0-9._]+$/, {
    message:
      "Username can only contain letters, numbers, underscores, and dots",
  });

export const displayUsernameSchema = z
  .string()
  .min(3, { message: "Diaplay Username should be at least 3 characters long" })
  .max(30, {
    message: "Diaplay Username should not be longer than 30 characters",
  })
  .regex(/^[a-zA-Z0-9._]+$/, {
    message:
      "Diaplay Username can only contain letters, numbers, underscores, and dots",
  });

export const nameSchema = z.string().min(1, { message: "Name is required" });

export const orgNameSchema = z
  .string()
  .min(3, { message: "Orginization name should be at least 3 characters long" })
  .max(30, {
    message: "Orginization should not be longer than 30 characters",
  }).regex(/^[a-zA-Z0-9._]+$/, {
    message:
      "Orginization name can only contain letters, numbers, underscores, and dots",
  });

  export const orgSlugScheme = z
  .string()
  .min(3, { message: "Slug should be at least 3 characters long" })
  .max(30, { message: "Slug should not be longer than 30 characters" })
  .regex(/^[a-zA-Z0-9._]+$/, {
    message:
      "Slug can only contain letters, numbers, underscores, and dots",
  });
