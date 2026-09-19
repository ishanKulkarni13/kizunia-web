"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { CreateProjectSchema, CreateProjectDto } from "../../../schemas";
import { ProjectApi } from "../../api/project-api";
import { ProjectErrorCode } from "../../../backend/errors/error-code";
import { slugify } from "@/utils/utils";
import { ApiError } from "@/lib/http";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export function CreateProjectForm() {
  const router = useRouter();

  const [isSlugTouched, setIsSlugTouched] = React.useState(false);

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<CreateProjectDto>({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      title: "",
      slug: "",
      shortDescription: "",
    },
  });

  async function onSubmit(data: CreateProjectDto) {
    setIsSubmitting(true);

    try {
      const project = await ProjectApi.create(data);

      router.push(`/projects/${project.id}/edit`);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === ProjectErrorCode.DUPLICATE_SLUG) {
          form.setError("slug", {
            message: error.message,
          });
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error("Failed to create project. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <FieldDescription className="mb-6">
          Your project will be created as a private draft. You can complete
          your project and publish it later.
        </FieldDescription>

        <form
          id="create-project-form"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FieldGroup>
            {/* Title */}

            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="title">Title</FieldLabel>

                  <Input
                    {...field}
                    id="title"
                    placeholder="My Awesome Robotics Project"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      field.onChange(event);

                      if (!isSlugTouched) {
                        form.setValue(
                          "slug",
                          slugify(event.target.value),
                          {
                            shouldValidate: form.formState.isSubmitted,
                          },
                        );
                      }
                    }}
                  />

                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Slug */}

            <Controller
              name="slug"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="slug">Slug</FieldLabel>

                  <Input
                    {...field}
                    id="slug"
                    placeholder="my-awesome-robotics-project"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      setIsSlugTouched(true);

                      field.onChange(event);
                    }}
                  />

                  <FieldDescription>
                    Used in your project&apos;s public URL. Editing this
                    stops it from following the title.
                  </FieldDescription>

                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Short Description */}

            <Controller
              name="shortDescription"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="shortDescription">
                    Short Description
                  </FieldLabel>

                  <InputGroup>
                    <InputGroupTextarea
                      {...field}
                      id="shortDescription"
                      rows={5}
                      className="min-h-24 resize-none"
                      placeholder="A short description of your project..."
                      aria-invalid={fieldState.invalid}
                    />

                    <InputGroupAddon align="block-end">
                      <InputGroupText className="tabular-nums">
                        {field.value.length}/500
                      </InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>

                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter>
        <Field orientation="horizontal">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              form.reset();
              setIsSlugTouched(false);
            }}
          >
            Reset
          </Button>

          <Button
            type="submit"
            form="create-project-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Project"}
          </Button>
        </Field>
      </CardFooter>
    </Card>
  );
}
