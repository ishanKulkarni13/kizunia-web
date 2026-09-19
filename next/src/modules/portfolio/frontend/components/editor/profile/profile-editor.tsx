"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePortfolioStore } from "../../../store/portfolio.store";
import { usePortfolioProfileStore } from "../../../store/portfolio-profile.store";
import { DocumentUploader } from "@/modules/assets/frontend/components/document-uploader";

export function ProfileEditor() {
  const portfolio = usePortfolioStore((state) => state.portfolio);

  const form = usePortfolioProfileStore((state) => state.form);
  const isSaving = usePortfolioProfileStore((state) => state.isSaving);
  const error = usePortfolioProfileStore((state) => state.error);
  const fieldErrors = usePortfolioProfileStore((state) => state.fieldErrors);
  const initialize = usePortfolioProfileStore((state) => state.initialize);
  const setField = usePortfolioProfileStore((state) => state.setField);
  const updateProfile = usePortfolioProfileStore((state) => state.updateProfile);

  useEffect(() => {
    if (portfolio) {
      initialize(portfolio);
    }
  }, [portfolio, initialize]);

  if (!portfolio) {
    return (
      <div>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Your portfolio could not be loaded.
          </p>
        </CardContent>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Manage the information people see on your portfolio.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Identity */}
      <div className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>

          <p className="text-sm text-muted-foreground">
            Introduce yourself to people visiting your portfolio.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>

            <Input
              id="display-name"
              value={form.displayName ?? ""}
              onChange={(event) => setField("displayName", event.target.value)}
              placeholder="Your name"
              maxLength={100}
            />

            {fieldErrors.displayName && (
              <p className="text-xs text-destructive">
                {fieldErrors.displayName}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="headline">Headline</Label>

            <Input
              id="headline"
              value={form.headline ?? ""}
              onChange={(event) =>
                setField("headline", event.target.value || null)
              }
              placeholder="Software Engineer"
              maxLength={150}
            />

            <p className="text-xs text-muted-foreground">
              A short description that appears below your name.
            </p>

            {fieldErrors.headline && (
              <p className="text-xs text-destructive">{fieldErrors.headline}</p>
            )}
          </div>
        </CardContent>
      </div>

      {/* About */}
      <div className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>

          <p className="text-sm text-muted-foreground">
            Tell people a little about yourself.
          </p>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>

            <Textarea
              id="bio"
              value={form.bio ?? ""}
              onChange={(event) => setField("bio", event.target.value || null)}
              placeholder="Tell people about yourself, what you build, and what you care about."
              maxLength={5000}
              className="min-h-40 resize-y"
            />

            <div className="flex justify-end">
              <span className="text-xs text-muted-foreground">
                {(form.bio ?? "").length}/5000
              </span>
            </div>

            {fieldErrors.bio && (
              <p className="text-xs text-destructive">{fieldErrors.bio}</p>
            )}
          </div>
        </CardContent>
      </div>

      {/* Contact */}
      <div className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>

          <p className="text-sm text-muted-foreground">
            Choose the contact information you want to make available through
            your portfolio.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="public-contact-email">Public email</Label>

            <Input
              id="public-contact-email"
              type="email"
              value={form.publicContactEmail ?? ""}
              onChange={(event) =>
                setField("publicContactEmail", event.target.value || null)
              }
              placeholder="you@example.com"
            />

            {fieldErrors.publicContactEmail && (
              <p className="text-xs text-destructive">
                {fieldErrors.publicContactEmail}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>

            <Input
              id="phone"
              value={form.phone ?? ""}
              onChange={(event) =>
                setField("phone", event.target.value || null)
              }
              placeholder="+91 ..."
              maxLength={30}
            />

            {fieldErrors.phone && (
              <p className="text-xs text-destructive">{fieldErrors.phone}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>

            <Input
              id="location"
              value={form.location ?? ""}
              onChange={(event) =>
                setField("location", event.target.value || null)
              }
              placeholder="Pune, India"
              maxLength={150}
            />

            {fieldErrors.location && (
              <p className="text-xs text-destructive">{fieldErrors.location}</p>
            )}
          </div>
        </CardContent>
      </div>

      {/* Resume */}
      <div className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle className="text-base">Resume</CardTitle>

          <p className="text-sm text-muted-foreground">
            Attach a resume to your portfolio.
          </p>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            {form.resumeAssetId && (
              <p className="text-sm text-muted-foreground">
                A resume is currently attached.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setField("resumeAssetId", null)}
                >
                  Remove
                </button>
              </p>
            )}

            <DocumentUploader
              purpose="PORTFOLIO_RESUME"
              accept="application/pdf"
              onUploaded={(asset) => setField("resumeAssetId", asset.id)}
            />

            <p className="text-xs text-muted-foreground">
              PDF only. Uploading a new resume replaces the current one once
              you save.
            </p>
          </div>
        </CardContent>
      </div>

      {/* Save */}
      <div className="flex justify-end pb-8">
        <Button
          type="button"
          onClick={() => void updateProfile()}
          disabled={isSaving || !(form.displayName ?? "").trim()}
        >
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
