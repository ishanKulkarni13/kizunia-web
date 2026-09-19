import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { ProjectPublicDetailsDto } from "@/modules/projects/backend/dto/output";

interface ProjectTeamMembersProps {
  members: ProjectPublicDetailsDto["members"];
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MAINTAINER: "Maintainer",
  CONTRIBUTOR: "Contributor",
};

export function ProjectTeamMembers({ members }: ProjectTeamMembersProps) {
  if (members.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {members.map((member) => (
        <div
          key={member.user.id}
          className="flex items-center gap-3 rounded-lg border p-3"
        >
          <Avatar className="size-10">
            <AvatarImage
              src={member.user.avatar?.url ?? member.user.image ?? undefined}
              alt={member.user.name}
            />
            <AvatarFallback>{member.user.name[0]}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{member.user.name}</p>

            {member.user.username && (
              <p className="truncate text-xs text-muted-foreground">
                @{member.user.username}
              </p>
            )}
          </div>

          <Badge variant="outline">
            {ROLE_LABEL[member.role] ?? member.role}
          </Badge>
        </div>
      ))}
    </div>
  );
}
