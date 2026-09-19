import { ProjectDetailsDto } from "@/modules/projects/backend/dto/output";

export interface PortfolioProjectDto {
  featured: boolean;

  hidden: boolean;

  displayOrder: number;

  project: ProjectDetailsDto;
}


// for future.....