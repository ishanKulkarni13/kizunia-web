// image-presets.ts

export const IMAGE_PRESETS = {
  avatar: {
    aspect: 1,
    cropShape: "round",
  },

  logo: {
    aspect: 1,
    cropShape: "rect",
  },

  banner: {
    aspect: 16 / 9,
    cropShape: "rect",
  },

  cover: {
    aspect: 3 / 1,
    cropShape: "rect",
  },

  blogHero: {
    aspect: 21 / 9,
    cropShape: "rect",
  },
} as const;