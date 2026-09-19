import type { CompetitionEligibilityRow } from "./competition-eligibility.repository";
import type { CompetitionEligibilityDTO } from "../types/competition-eligibility.dto";

export class CompetitionEligibilityMapper {
  toDTO(eligibility: CompetitionEligibilityRow): CompetitionEligibilityDTO {
    return {
      type: eligibility.type,
    };
  }

  toDTOs(
    eligibilities: CompetitionEligibilityRow[],
  ): CompetitionEligibilityDTO[] {
    return eligibilities.map((eligibility) => this.toDTO(eligibility));
  }
}

export const competitionEligibilityMapper = new CompetitionEligibilityMapper();
