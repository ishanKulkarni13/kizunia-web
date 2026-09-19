import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";

import PageWrapper from "@/components/page-wrapper";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ForwardRefMdxViewer } from "@/components/shared/mdx/ForwardRefMdxViewer";
import { SessionService } from "@/lib/auth/session";
import { PlatformRole } from "@/authorization";
import { AuthorizationError } from "@/lib/errors";
import { projectService } from "@/modules/projects/backend/service";
import { ProjectNotFoundError } from "@/modules/projects/backend/errors";
import { ProjectViewHeader } from "@/modules/projects/frontend/components/view/project-view-header";
import { ProjectLinksList } from "@/modules/projects/frontend/components/view/project-links-list";
import { ProjectTeamMembers } from "@/modules/projects/frontend/components/view/project-team-members";
import { ProjectTestimonials } from "@/modules/projects/frontend/components/view/project-testimonials";

interface Props {
  // Folder name is `[projectId]` to share the segment with the sibling
  // `[projectId]/edit` tree and avoid a Next.js dynamic-segment-name
  // collision. This page's own value is a project *slug*, not an id —
  // matching how `ProjectCard` already links via `/projects/${project.slug}`.
  params: Promise<{ projectId: string }>;
}

/**
 * Public project view — `/projects/[slug]`.
 *
 * Authorization is entirely server-side: `projectService.findPublicBySlug`
 * runs `ProjectPolicy.canView` before any data is returned. Both "the slug
 * doesn't exist" and "the slug exists but this viewer can't see it" collapse
 * to the same `notFound()` response, so a private project's existence is
 * never distinguishable from a typo.
 */
export default async function ProjectViewPage({ params }: Props) {
  const { projectId: slug } = await params;

  const actor = await SessionService.getOptionalActor();

  const actorData = {
    id: actor?.id ?? null,
    role: actor?.role ?? PlatformRole.USER,
    banned: actor?.banned ?? false,
  };

  let project;

  try {
    project = await projectService.findPublicBySlug({ slug, actor: actorData });
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof AuthorizationError) {
      notFound();
    }

    throw error;
  }

  const isAboutSectionRequired = project.content && project.content.trim().length > 0;

  return (
    <PageWrapper
      breadcrumbs={[
        { label: "Projects", href: "/projects" },
        { label: project.title, href: `/projects/${project.slug}` },
      ]}
    >
      <div className="mx-auto w-full max-w-7xl space-y-8">
        {project.cover && (
          <div className="relative aspect-[3/1] w-full overflow-hidden rounded-xl border">
            <Image
              src={project.cover.url}
              alt={project.title}
              fill
              priority
              className="object-cover"
              sizes="100vw"
            />
          </div>
        )}

        <Card className="p-8">
          <ProjectViewHeader project={project} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {isAboutSectionRequired && (
              <Card className="space-y-4 p-6">
                <h2 className="text-2xl font-semibold">About</h2>

                <Suspense fallback={null}>
                  <ForwardRefMdxViewer markdown={project.content ?? ""} />
                </Suspense>
              </Card>
            )}

            {project.members.length > 0 && (
              <Card className="space-y-4 p-6">
                <h2 className="text-xl font-semibold">Team</h2>

                <Separator />

                <ProjectTeamMembers members={project.members} />
              </Card>
            )}

            {project.testimonials.length > 0 && (
              <Card className="space-y-4 p-6">
                <h2 className="text-xl font-semibold">Testimonials</h2>

                <Separator />

                <ProjectTestimonials testimonials={project.testimonials} />
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {project.links.length > 0 && (
              <Card className="space-y-4 p-6">
                <h2 className="text-lg font-semibold">Links</h2>

                <Separator />

                <ProjectLinksList links={project.links} />
              </Card>
            )}

            {(project.startDate || project.endDate) && (
              <Card className="space-y-4 p-6">
                <h2 className="text-lg font-semibold">Timeline</h2>

                <Separator />

                <div className="space-y-2 text-sm text-muted-foreground">
                  {project.startDate && (
                    <p>
                      Started{" "}
                      {new Date(project.startDate).toLocaleDateString()}
                    </p>
                  )}

                  {project.endDate && (
                    <p>
                      Ended {new Date(project.endDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
