import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/utils/utils";

import type { PortfolioTechnologySummaryDto } from "../../../../dtos";
import type { UpdatePortfolioTechnologyInput } from "../../../../schemas/portfolio-technology.schema";
import { EditTechnologyMetadataDialog } from "./edit-technology-metadata-dialog";
import { RemoveTechnologyConfirm } from "./remove-technology-confirm";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

interface PortfolioTechnologyCardProps {
  technology: PortfolioTechnologySummaryDto;

  busy: boolean;

  canMoveUp: boolean;

  canMoveDown: boolean;

  onMoveUp: () => void;

  onMoveDown: () => void;

  onUpdate: (dto: UpdatePortfolioTechnologyInput) => Promise<void>;

  onRemove: () => void;
}

export function PortfolioTechnologyCard({
  technology,
  busy,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRemove,
}: PortfolioTechnologyCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <Avatar className="size-9 shrink-0">
        <AvatarImage src={technology.icon?.url} alt={technology.name} />
        <AvatarFallback>{getInitials(technology.name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate font-medium">{technology.name}</p>

          <Badge variant="secondary">{technology.type}</Badge>

          {technology.startedUsingAt && (
            <Badge variant="outline">
              Since {DATE_FORMATTER.format(new Date(technology.startedUsingAt))}
            </Badge>
          )}
        </div>

        {technology.description && (
          <p className="truncate text-xs text-muted-foreground">
            {technology.description}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !canMoveUp}
          onClick={onMoveUp}
          aria-label="Move technology up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !canMoveDown}
          onClick={onMoveDown}
          aria-label="Move technology down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>

        <EditTechnologyMetadataDialog
          technology={technology}
          busy={busy}
          onSubmit={onUpdate}
        />

        <RemoveTechnologyConfirm
          technologyName={technology.name}
          busy={busy}
          onConfirm={onRemove}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label="Remove technology from portfolio"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          }
        />
      </div>
    </div>
  );
}
