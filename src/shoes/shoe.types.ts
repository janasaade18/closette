export type ShoeCategory =
  'heel' | 'sneaker' | 'sandal' | 'boot' | 'bootie' | 'flat' | 'other';

export type ShoeSize = {
  id: string;
  label: string;
  lengthMm: number;
  forefootWidthMm: number | null;
  heelWidthMm: number | null;
};

export type Shoe = {
  id: string;
  slug: string;
  name: string;
  category: ShoeCategory;
  listed: boolean;
  brand: {
    id: string;
    slug: string;
    name: string;
    isDemo: boolean;
  };
  meshUrl: string | null;
  meshFormat: string | null;
  meshLocalFile: string | null;
  thumbnailUrl: string | null;
  sizes: ShoeSize[];
};

export type FitRecommendation = {
  shoeId: string;
  shoeSlug: string;
  recommendedSize: string | null;
  confidence: number;
  lengthDeltaMm: number | null;
  widthDeltaMm: number | null;
  alternatives: Array<{ label: string; score: number }>;
  foot: {
    lengthMm: number;
    forefootWidthMm?: number;
    source: 'scan' | 'manual';
  };
  tryOn: {
    meshUrl: string | null;
    meshFormat: string | null;
    meshLocalFile: string | null;
  };
};
