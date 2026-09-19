import type { ZodError } from "zod";

import type { ValidationDetails } from "./validation-details";

export function convertZodError(error: ZodError): ValidationDetails {
  const details: ValidationDetails = {
    form: [],
    fields: {},
  };

  const flattened = error.flatten();

  details.form = flattened.formErrors;

  for (const [field, messages] of Object.entries(flattened.fieldErrors) as [
    string,
    string[] | undefined,
  ][]) {
    if (!messages?.length) continue;

    details.fields[field] = messages[0];
  }

  return details;
}
