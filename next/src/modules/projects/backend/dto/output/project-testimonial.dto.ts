interface ProjectTestimonialAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}

export interface ProjectTestimonialDto {
  id: string;

  name: string;

  position: string | null;

  company: string | null;

  message: string;

  rating: number | null;

  displayOrder: number;

  image: ProjectTestimonialAssetDto | null;
}
