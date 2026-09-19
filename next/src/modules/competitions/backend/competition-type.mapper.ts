import type { CompetitionTypeRelationRow } from "./competition-type.repository";
import type { CompetitionTypeDTO } from "../types/competition-type.dto";

export class CompetitionTypeMapper {
  toDTO(row: CompetitionTypeRelationRow): CompetitionTypeDTO {
    return {
      type: row.type,
    };
  }

  toDTOs(rows: CompetitionTypeRelationRow[]): CompetitionTypeDTO[] {
    return rows.map((row) => this.toDTO(row));
  }
}

export const competitionTypeMapper = new CompetitionTypeMapper();
