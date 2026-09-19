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

export const MIN_ACCEPTED_FRAMES = 30;
export const MAX_ACCEPTED_FRAMES = 60;
export const MIN_FRAMES_PER_VIEW = 6;

export const FOOT_CAPTURE_GUIDES: CaptureGuide[] = [
  {
    view: 'top',
    title: 'Place your foot inside the outline',
    instruction:
      'Look straight down. Keep the whole foot inside the outline. Move slowly.',
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
