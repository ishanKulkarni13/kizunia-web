import { notFound } from "next/navigation";
import {
  Calendar,
  Globe,
  MapPin,
  SquareArrowOutUpRight,
  Trophy,
  Users,
  CreditCard,
  Monitor,
  GraduationCap,
} from "lucide-react";

import PageWrapper from "@/components/page-wrapper";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ForwardRefEditor } from "@/components/shared/mdx/ForwardRefEditor";
import { Suspense } from "react";
import { CompetitionApi } from "@/modules/competitions/api/competition-api";
import { ForwardRefMdxViewer } from "@/components/shared/mdx/ForwardRefMdxViewer";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ApiError } from "@/lib/http";
import { CompetitionErrorCode } from "@/modules/competitions/errors/error-code";
import {
  COMPETITION_MODE_OPTIONS,
  COMPETITION_STATUS_OPTIONS,
  DIFFICULTY_OPTIONS,
  ELIGIBILITY_OPTIONS,
  getCompetitionEnumLabel,
  ORGANIZER_TYPE_OPTIONS,
  REGISTRATION_FEE_TYPE_OPTIONS,
  REGISTRATION_PLATFORM_OPTIONS,
} from "@/modules/competitions/constants";
import { CompetitionUserStateProvider } from "@/modules/competitions/components/user-state/competition-user-state-provider";
import { CompetitionBookmarkButton } from "@/modules/competitions/components/user-state/competition-bookmark-button";
import { CompetitionRegistrationButton } from "@/modules/competitions/components/user-state/competition-registration-button";
export default async function CompetitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    location?: string;
    organizer?: string;
    minTeamSize?: string;
  }>;
}) {
  const { slug } = await params;
  let response;
  try {
    response = await CompetitionApi.getPublic(slug);
  } catch (error) {
    if (error instanceof ApiError) {
      if (
        error.code == CompetitionErrorCode.NOT_FOUND ||
        error.code == CompetitionErrorCode.ARCHIVED ||
        error.code == CompetitionErrorCode.DELETED
      )
        notFound();
    } else {
      throw error;
    }
  }
  if (!!!response) {
    notFound();
  }
  const competition = response.data;

  const isSideBarRequired =
    competition.registrationDeadline ||
    competition.startDate ||
    competition.endDate ||
    competition.prizePool ||
    competition.locations.length > 0 ||
    competition.minTeamSize ||
    competition.maxTeamSize ||
    competition.mode ||
    competition.registrationFee !== null ||
    competition.registrationFeeType ||
    competition.registrationPlatform ||
    competition.eligibilities.length > 0;

  const isAboutSectionRequired =
    competition.content?.content &&
    competition.content?.content !== "No documentation.";

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Competitions", href: "/competitions" },
        { label: competition.title, href: `/competitions/${competition.slug}` },
      ]}
    >
      <CompetitionUserStateProvider>
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        {competition.bannerAsset && (
          <div className="relative aspect-[3/1] w-full rounded-xl overflow-hidden border">
            <Image
              src={competition.bannerAsset.secureUrl}
              alt={competition.title}
              fill
              priority
              className="object-cover"
              sizes="100vw"
            />
          </div>
        )}
        <Card className="p-8">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border">
              {competition.logoAsset ? (
                <Image
                  src={competition.logoAsset.secureUrl}
                  alt={`${competition.title} logo`}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-3xl font-bold">
                  {competition.title[0]}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-4xl font-bold">{competition.title}</h1>

                  <p className="mt-1 text-muted-foreground">
                    {competition.organizer}
                  </p>
                </div>

                {/*
                  Per-user actions sit with the status badge in the header's
                  top-right. Both render unconditionally — including when
                  there is no registrationLink (the user may have registered
                  through a channel Kizunia doesn't know about) and at every
                  lifecycle status (see CompetitionRegistrationService).
                */}
                <div className="flex items-center gap-2">
                  {competition.status && (
                    <Badge>
                      {getCompetitionEnumLabel(
                        competition.status,
                        COMPETITION_STATUS_OPTIONS,
                      )}
                    </Badge>
                  )}

                  <CompetitionRegistrationButton
                    competitionId={competition.id}
                  />

                  <CompetitionBookmarkButton
                    competitionId={competition.id}
                    title={competition.title}
                  />
                </div>
              </div>

              {competition.shortDescription && (
                <p className="text-muted-foreground">
                  {competition.shortDescription}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {competition.mode && (
                  <Badge variant="secondary">
                    {getCompetitionEnumLabel(
                      competition.mode,
                      COMPETITION_MODE_OPTIONS,
                    )}
                  </Badge>
                )}

                {competition.difficulty && (
                  <Badge variant="outline">
                    {getCompetitionEnumLabel(
                      competition.difficulty,
                      DIFFICULTY_OPTIONS,
                    )}
                  </Badge>
                )}

                {/* {competition.certificateType && (
                  <Badge variant="outline">{competition.certificateType.replaceAll("_", " ")}</Badge>
                )} */}

                {competition.organizerType && (
                  <Badge variant="outline">
                    {getCompetitionEnumLabel(
                      competition.organizerType,
                      ORGANIZER_TYPE_OPTIONS,
                    )}
                  </Badge>
                )}

                {competition.locations.map((competitionLocation) => (
                  <Badge key={competitionLocation.id} variant="outline">
                    <MapPin className="mr-1 h-3 w-3" />
                    {competitionLocation.location.displayName}
                  </Badge>
                ))}

                {competition.website && (
                  <Badge asChild variant="default">
                    <Link
                      href={competition.website}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Globe className="mr-1 h-3 w-3" />
                      Official Website
                    </Link>
                  </Badge>
                )}

                {competition.registrationLink && (
                  <Badge asChild>
                    <Link
                      href={competition.registrationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <SquareArrowOutUpRight className="mr-1 h-3 w-3" />
                      Register
                    </Link>
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Information */}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="order-2 space-y-6 lg:order-1 lg:col-span-2">
            {isAboutSectionRequired && (
              <Card className="p-6 space-y-4">
                <h1 className="text-4xl font-semibold">About</h1>

                {/* <Separator /> */}

                <div>
                  {/* {competition.content?.content ?? "Documentation coming soon."}{" "} */}
                  <Suspense fallback={null}>
                    <ForwardRefMdxViewer
                      markdown={
                        competition.content?.content ?? "No documentation."
                      }
                    />
                  </Suspense>
                </div>
              </Card>
            )}

            {competition.categories.length > 0 && (
              <Card className="p-6 space-y-4">
                <h2 className="text-xl font-semibold">Categories</h2>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  {competition.categories.map((category) => (
                    <Badge key={category.categoryId} variant="secondary">
                      {category.category.name}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}

            {competition.technologies.length > 0 && (
              <Card className="p-6 space-y-4">
                <h2 className="text-xl font-semibold">Technologies</h2>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  {competition.technologies.map((tech) => (
                    <Badge key={tech.technologyId} variant="outline">
                      {tech.technology.name}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}

          </div>

          {/* Sidebar */}

          {isSideBarRequired && (
            <div className="order-1 lg:order-2">
              <Card className="p-6 space-y-5">
                <h2 className="text-lg font-semibold">Competition Details</h2>

                {competition.registrationDeadline && (
                  <div className="flex gap-3">
                    <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Registration Ends</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(
                          competition.registrationDeadline,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}

                {competition.startDate && (
                  <div className="flex gap-3">
                    <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Starts</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(competition.startDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}

                {competition.endDate && (
                  <div className="flex gap-3">
                    <Calendar className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Ends</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(competition.endDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                )}

                {competition.prizePool && (
                  <div className="flex gap-3">
                    <Trophy className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Prize Pool</p>
                      <p className="text-sm text-muted-foreground">
                        {competition.prizePool}
                      </p>
                    </div>
                  </div>
                )}

                {competition.locations.length > 0 && (
                  <div className="flex gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div className="space-y-3">
                      <p className="font-medium">
                        {competition.locations.length > 1
                          ? "Locations"
                          : "Location"}
                      </p>

                      {competition.locations.map((competitionLocation) => (
                        <div key={competitionLocation.id}>
                          {competitionLocation.label && (
                            <p className="text-sm font-medium">
                              {competitionLocation.label}
                            </p>
                          )}

                          <p className="text-sm text-muted-foreground">
                            {competitionLocation.venueName
                              ? `${competitionLocation.venueName}, ${competitionLocation.location.displayName}`
                              : competitionLocation.location.displayName}
                          </p>

                          {competitionLocation.startDate && (
                            <p className="text-xs text-muted-foreground">
                              {new Date(
                                competitionLocation.startDate,
                              ).toLocaleDateString()}

                              {competitionLocation.endDate &&
                                ` – ${new Date(
                                  competitionLocation.endDate,
                                ).toLocaleDateString()}`}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {competition.eligibilities.length > 0 && (
                  <div className="flex gap-3">
                    <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 space-y-2">
                      <p className="font-medium">Eligibility</p>

                      <div className="flex flex-wrap gap-1.5">
                        {competition.eligibilities.map((eligibility) => (
                          <Badge
                            key={eligibility.type}
                            variant="outline"
                            className="whitespace-normal text-left"
                          >
                            {getCompetitionEnumLabel(
                              eligibility.type,
                              ELIGIBILITY_OPTIONS,
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {(competition.minTeamSize || competition.maxTeamSize) && (
                  <div className="flex gap-3">
                    <Users className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Team Size</p>
                      <p className="text-sm text-muted-foreground">
                        {competition.minTeamSize ?? 1}
                        {competition.maxTeamSize &&
                          ` - ${competition.maxTeamSize}`}
                      </p>
                    </div>
                  </div>
                )}

                {competition.mode && (
                  <div className="flex gap-3">
                    <Globe className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Mode</p>
                      <p className="text-sm text-muted-foreground">
                        {getCompetitionEnumLabel(
                          competition.mode,
                          COMPETITION_MODE_OPTIONS,
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {(competition.registrationFee !== null ||
                  competition.registrationFeeType) && (
                  <div className="flex gap-3">
                    <CreditCard className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Registration Fee</p>
                      <p className="text-sm text-muted-foreground">
                        {competition.registrationFeeType === "FREE"
                          ? getCompetitionEnumLabel(
                              competition.registrationFeeType,
                              REGISTRATION_FEE_TYPE_OPTIONS,
                            )
                          : `${competition.registrationFee ?? ""} ${
                              getCompetitionEnumLabel(
                                competition.registrationFeeType,
                                REGISTRATION_FEE_TYPE_OPTIONS,
                              ) ?? ""
                            }`.trim()}
                      </p>
                    </div>
                  </div>
                )}

                {competition.registrationPlatform && (
                  <div className="flex gap-3">
                    <Monitor className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Registration Platform</p>
                      <p className="text-sm text-muted-foreground">
                        {getCompetitionEnumLabel(
                          competition.registrationPlatform,
                          REGISTRATION_PLATFORM_OPTIONS,
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
      </CompetitionUserStateProvider>
    </PageWrapper>
  );
}
