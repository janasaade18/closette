import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { FootSide } from '../dto/create-scan.dto';
import { FootCaptureView } from '../constants/capture-guides';

export type ScanStatus = 'capturing' | 'processing' | 'ready' | 'failed';

export type ReconstructionStatus =
  'idle' | 'queued' | 'running' | 'needs_colmap' | 'ready' | 'failed';

export type ScanDocument = HydratedDocument<Scan>;

@Schema({ _id: false })
export class CameraIntrinsics {
  @Prop({ type: Number })
  fx?: number;

  @Prop({ type: Number })
  fy?: number;

  @Prop({ type: Number })
  cx?: number;

  @Prop({ type: Number })
  cy?: number;

  @Prop({ type: Number })
  width?: number;

  @Prop({ type: Number })
  height?: number;
}

@Schema({ _id: false })
export class DeviceInfo {
  @Prop({ type: String })
  brand?: string;

  @Prop({ type: String })
  model?: string;

  @Prop({ type: String })
  os?: string;
}

@Schema({ _id: false })
export class ScaleReference {
  @Prop({ type: String, default: 'calibration_mat' })
  type?: string;

  @Prop({ type: Number, default: 200 })
  markerDistanceMm?: number;
}

@Schema({ _id: false })
export class CameraPose {
  @Prop({ type: [Number], default: undefined })
  rotation?: number[];

  @Prop({ type: [Number], default: undefined })
  translation?: number[];
}

@Schema({ _id: false })
export class ScanFrame {
  @Prop({ required: true, type: Number })
  index: number;

  @Prop({ required: true, type: String })
  view: FootCaptureView;

  @Prop({ required: true, type: String })
  storagePath: string;

  @Prop({ required: true, type: String })
  url: string;

  @Prop({ type: Boolean, default: true })
  accepted: boolean;

  @Prop({ type: Number })
  sharpness?: number;

  @Prop({ type: Boolean })
  footVisible?: boolean;

  @Prop({ type: Number })
  footAreaRatio?: number;

  @Prop({ type: CameraPose })
  pose?: CameraPose;

  @Prop({ type: Date })
  capturedAt?: Date;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;
}

@Schema({ _id: false })
export class Reconstruction {
  @Prop({
    type: String,
    default: 'idle',
  })
  status: ReconstructionStatus;

  @Prop({ type: String, default: null })
  glbUrl: string | null;

  @Prop({ type: String, default: null })
  objUrl: string | null;

  @Prop({ type: String })
  workDir?: string;

  @Prop({ type: String })
  message?: string;
}

@Schema({ timestamps: true })
export class Scan {
  @Prop({ required: true, type: String, enum: FootSide })
  footSide: FootSide;

  @Prop({ type: DeviceInfo })
  device?: DeviceInfo;

  @Prop({ type: CameraIntrinsics })
  cameraIntrinsics?: CameraIntrinsics;

  @Prop({ type: ScaleReference })
  scaleReference?: ScaleReference;

  @Prop({
    required: true,
    type: String,
    enum: ['capturing', 'processing', 'ready', 'failed'],
    default: 'capturing',
  })
  status: ScanStatus;

  @Prop({ type: [ScanFrame], default: [] })
  frames: ScanFrame[];

  @Prop({ type: [Object], default: [] })
  segmentationMasks: Record<string, unknown>[];

  @Prop({ type: [Object], default: [] })
  landmarks: Record<string, unknown>[];

  @Prop({ type: Reconstruction, default: () => ({ status: 'idle' }) })
  reconstruction: Reconstruction;

  @Prop({ type: String })
  error?: string;
}

export const ScanSchema = SchemaFactory.createForClass(Scan);
