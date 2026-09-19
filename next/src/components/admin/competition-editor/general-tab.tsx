"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FieldSet, FieldLegend } from "@/components/ui/field";
import {
  COMPETITION_STATUS_OPTIONS,
  COMPETITION_VISIBILITY_OPTIONS,
  COMPETITION_MODE_OPTIONS,
  REGISTRATION_PLATFORM_OPTIONS,
  CERTIFICATE_OPTIONS,
  DIFFICULTY_OPTIONS,
  ORGANIZER_TYPE_OPTIONS,
  REGISTRATION_FEE_TYPE_OPTIONS,
} from "@/modules/competitions/constants";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import { SelectField } from "./select-field";
import { AssetsTab } from "./assets-tab";
import { EditorField } from "./editor-field";
import { TeamSizeField } from "./team-size-field";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useFieldStatus } from "./use-field-status";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

export function GeneralTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const updateCompetition = useCompetitionEditorStore(
    (state) => state.updateCompetition,
  );

  const regenerateSlug = useCompetitionEditorStore((s) => s.regenerateSlug);

  const fieldErrors = useCompetitionEditorStore((s) => s.fieldErrors);

  const titleStatus = useFieldStatus("title");
  const slugStatus = useFieldStatus("slug");
  const organizerStatus = useFieldStatus("organizer");
  const websiteStatus = useFieldStatus("website");
  const shortDescriptionStatus = useFieldStatus("shortDescription");
  const visibilityStatus = useFieldStatus("visibility");
  const statusStatus = useFieldStatus("status");
  const modeStatus = useFieldStatus("mode");
  const registrationPlatformStatus = useFieldStatus("registrationPlatform");
  const registrationLinkStatus = useFieldStatus("registrationLink");
  const prizePoolStatus = useFieldStatus("prizePool");
  const registrationFeeStatus = useFieldStatus("registrationFee");
  const registrationFeeTypeStatus = useFieldStatus("registrationFeeType");
  const organizerTypeStatus = useFieldStatus("organizerType");
  const difficultyStatus = useFieldStatus("difficulty");
  const certificateTypeStatus = useFieldStatus("certificateType");

  if (!competition) {
    return null;
  }

  return (
    <div className="space-y-8 pt-6">
      <FieldSet id="field-logoAsset">
        <FieldLegend variant="label">Assets</FieldLegend>
        <AssetsTab />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Identity</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <EditorField label="Title" htmlFor="title" fieldKey="title" status={titleStatus}>
            <Input
              id="title"
              value={competition.title ?? ""}
              onChange={(e) => updateCompetition({ title: e.target.value })}
            />
          </EditorField>

          <EditorField
            label="Slug"
            htmlFor="slug"
            fieldKey="slug"
            status={slugStatus}
            error={fieldErrors.slug}
            description={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => regenerateSlug()}
              >
                Generate from title
              </Button>
            }
          >
            <Input
              id="slug"
              value={competition.slug ?? ""}
              onChange={(e) => updateCompetition({ slug: e.target.value })}
            />
          </EditorField>

          <EditorField
            label="Organizer"
            htmlFor="organizer"
            fieldKey="organizer"
            status={organizerStatus}
          >
            <Input
              id="organizer"
              value={competition.organizer ?? ""}
              onChange={(e) =>
                updateCompetition({ organizer: e.target.value })
              }
            />
          </EditorField>

          <EditorField label="Website" htmlFor="website" fieldKey="website" status={websiteStatus}>
            <Input
              id="website"
              value={competition.website ?? ""}
              onChange={(e) => updateCompetition({ website: e.target.value })}
            />
          </EditorField>

          <EditorField
            label="Short Description"
            htmlFor="shortDescription"
            fieldKey="shortDescription"
            status={shortDescriptionStatus}
            className="sm:col-span-2"
          >
            <Textarea
              id="shortDescription"
              rows={4}
              value={competition.shortDescription ?? ""}
              onChange={(e) =>
                updateCompetition({ shortDescription: e.target.value })
              }
            />
          </EditorField>
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Classification</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Status"
            value={competition.status}
            options={COMPETITION_STATUS_OPTIONS}
            nullable
            fieldKey="status"
            status={statusStatus}
            onValueChange={(status) =>
              updateCompetition({
                status: status as typeof competition.status,
              })
            }
          />

          <SelectField
            label="Visibility"
            value={competition.visibility}
            options={COMPETITION_VISIBILITY_OPTIONS}
            fieldKey="visibility"
            status={visibilityStatus}
            onValueChange={(visibility) =>
              updateCompetition({
                visibility: visibility as typeof competition.visibility,
              })
            }
          />

          <SelectField
            label="Mode"
            value={competition.mode}
            options={COMPETITION_MODE_OPTIONS}
            nullable
            fieldKey="mode"
            status={modeStatus}
            onValueChange={(mode) =>
              updateCompetition({ mode: mode as typeof competition.mode })
            }
          />

          <SelectField
            label="Organizer Type"
            value={competition.organizerType}
            options={ORGANIZER_TYPE_OPTIONS}
            nullable
            fieldKey="organizerType"
            status={organizerTypeStatus}
            onValueChange={(organizerType) =>
              updateCompetition({
                organizerType: organizerType as typeof competition.organizerType,
              })
            }
          />

          <SelectField
            label="Difficulty"
            value={competition.difficulty}
            options={DIFFICULTY_OPTIONS}
            nullable
            fieldKey="difficulty"
            status={difficultyStatus}
            onValueChange={(difficulty) =>
              updateCompetition({
                difficulty: difficulty as typeof competition.difficulty,
              })
            }
          />

          <SelectField
            label="Certificate"
            value={competition.certificateType}
            options={CERTIFICATE_OPTIONS}
            nullable
            fieldKey="certificateType"
            status={certificateTypeStatus}
            onValueChange={(certificateType) =>
              updateCompetition({
                certificateType:
                  certificateType as typeof competition.certificateType,
              })
            }
          />
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Registration</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <EditorField
            label="Registration Link"
            htmlFor="registrationLink"
            fieldKey="registrationLink"
            status={registrationLinkStatus}
          >
            <Input
              id="registrationLink"
              value={competition.registrationLink ?? ""}
              onChange={(e) =>
                updateCompetition({ registrationLink: e.target.value })
              }
            />
          </EditorField>

          <SelectField
            label="Registration Platform"
            value={competition.registrationPlatform}
            options={REGISTRATION_PLATFORM_OPTIONS}
            nullable
            fieldKey="registrationPlatform"
            status={registrationPlatformStatus}
            onValueChange={(registrationPlatform) =>
              updateCompetition({
                registrationPlatform:
                  registrationPlatform as typeof competition.registrationPlatform,
              })
            }
          />

          <EditorField
            label="Prize Pool"
            htmlFor="prizePool"
            fieldKey="prizePool"
            status={prizePoolStatus}
          >
            <Input
              id="prizePool"
              placeholder="Prize Pool"
              value={competition.prizePool ?? ""}
              onChange={(e) =>
                updateCompetition({ prizePool: e.target.value })
              }
            />
          </EditorField>

          <EditorField
            label="Registration Fee"
            htmlFor="registrationFee"
            fieldKey="registrationFee"
            status={registrationFeeStatus}
          >
            <Input
              id="registrationFee"
              placeholder="Registration Fee"
              value={competition.registrationFee ?? ""}
              onChange={(e) =>
                updateCompetition({ registrationFee: e.target.value })
              }
            />
          </EditorField>

          <SelectField
            label="Registration Fee Type"
            value={competition.registrationFeeType}
            options={REGISTRATION_FEE_TYPE_OPTIONS}
            nullable
            fieldKey="registrationFeeType"
            status={registrationFeeTypeStatus}
            onValueChange={(registrationFeeType) =>
              updateCompetition({
                registrationFeeType:
                  registrationFeeType as typeof competition.registrationFeeType,
              })
            }
          />

          <TeamSizeField
            minTeamSize={competition.minTeamSize}
            maxTeamSize={competition.maxTeamSize}
            onChange={({ minTeamSize, maxTeamSize }) =>
              updateCompetition({ minTeamSize, maxTeamSize })
            }
          />
        </div>
      </FieldSet>

      <TabCompletenessFooter tab="general" />
    </div>
  );
}
