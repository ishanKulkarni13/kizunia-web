import { HttpClient } from "@/lib/http/client";
import type { TaxonomyOptionDTO } from "@/modules/taxonomy/types/taxonomy-option.dto";

/**
 * Value catalogs for the preference dimensions that are not enum-backed
 * (categories, technologies, location). Technologies and location already
 * have their own frontend API clients (`TechnologyApi.getCatalog`,
 * `LocationApi.searchAreas`) — this only fills the one gap: categories.
 */
export class DimensionCatalogApi {
  static async categories(): Promise<TaxonomyOptionDTO[]> {
    // `includeEmpty=true`: a preference is about what the user cares about,
    // not what currently has open competitions, so a category with zero
    // visible rows right now must still be selectable.
    const response = await HttpClient.get<TaxonomyOptionDTO[]>(
      "/api/v1/categories?entity=competition&limit=200&includeEmpty=true",
    );

    return response.data;
  }
}
