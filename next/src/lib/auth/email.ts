// import { Resend } from "resend";

// const resend = new Resend(process.env.RESEND_API_KEY);

import { logger } from "@/lib/logger";

interface SendEmailValues {
  to: string;
  subject: string;
  text: string;
}

/**
 * The recipient and body are deliberately never logged — `text` is
 * free-form and, for the password-reset flow, contains the live reset
 * token URL. The key-based sanitizer would not catch a token embedded in
 * that string, so it is left out of the log call entirely rather than
 * relying on redaction.
 */
export async function sendEmail({ to, subject, text }: SendEmailValues) {
  logger.info("auth.email_dispatch_attempted", { subject });

  // await resend.emails.send({
  //   from: "verification@codinginflow-sample.com",
  //   to,
  //   subject,
  //   text,
  // });
}
