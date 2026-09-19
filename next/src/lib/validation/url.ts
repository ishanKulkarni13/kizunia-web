import { z } from "zod";

export const emptyStringToUndefined = (value: unknown) =>
    value === "" ? undefined : value;

export const UrlSchema =  z
        .string()
        .url("Please enter a valid website URL.")