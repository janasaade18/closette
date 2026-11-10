export const FOOT_CAPTURE_VIEWS = [
  'top',
  'front',
  'left',
  'right',
  'heel',
] as const;

export type FootCaptureView = (typeof FOOT_CAPTURE_VIEWS)[number];

export type CaptureGuide = {
  view: FootCaptureView;
  title: string;
  instruction: string;
  order: number;
  required: boolean;
};

export const MIN_ACCEPTED_FRAMES = 5;
export const MAX_ACCEPTED_FRAMES = 60;
export const MIN_FRAMES_PER_VIEW = 1;

/** Phone outline (cadre) fit thresholds — client turns red → green, then captures. */
export const OUTLINE_FIT = {
  colorNotReady: '#E53935',
  colorReady: '#43A047',
  requireFootVisible: true,
  /** Fraction of the frame occupied by the foot (0–1). */
  minFootAreaRatio: 0.28,
  maxFootAreaRatio: 0.78,
  minSharpness: 80,
  /** Hold still 2 seconds with foot in the outline before capture. */
  stableMs: 2000,
  autoCaptureOnReady: true,
  advanceToNextViewAfterCapture: true,
} as const;

export const FOOT_CAPTURE_GUIDES: CaptureGuide[] = [
  {
    view: 'top',
    title: 'Place your foot inside the outline',
    instruction:
      'Get close. Fill the outline with only your foot (no calf). Hold still until green.',
    order: 1,
    required: true,
  },
  {
    view: 'front',
    title: 'Move to the front',
    instruction:
      'Point the camera at the toes. Keep the foot large in the frame and move slowly.',
    order: 2,
    required: true,
  },
  {
    view: 'left',
    title: 'Move to the left side',
    instruction:
      'Orbit to the left of the foot. Keep the arch and ankle visible.',
    order: 3,
    required: true,
  },
  {
    view: 'right',
    title: 'Move to the right side',
    instruction: 'Orbit to the right of the foot. Keep the outer edge in view.',
    order: 4,
    required: true,
  },
  {
    view: 'heel',
    title: 'Capture the heel',
    instruction:
      'Point the camera at the back of the heel. Keep the heel centered.',
    order: 5,
    required: true,
  },
];

export const REQUIRED_FOOT_VIEWS = FOOT_CAPTURE_GUIDES.filter(
  (guide) => guide.required,
).map((guide) => guide.view);
