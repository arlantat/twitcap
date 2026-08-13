export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "normalizing"
  | "translating"
  | "polishing"
  | "done"
  | "error";

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "queued",
  "downloading",
  "transcribing",
  "normalizing",
  "translating",
  "polishing",
];

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

export interface JobArtifacts {
  audio?: string; // filename within job dir, e.g. "audio.m4a"
  segmentsJson?: string;
  jpSrt?: string;
  /** Target-language caption files (captions.<lang>.srt/vtt). */
  subSrt?: string;
  subVtt?: string;
  subJson?: string;
  /** Legacy EN-only artifact names (pre-multilanguage jobs). */
  enSrt?: string;
  enVtt?: string;
  enJson?: string;
}

export interface Job {
  id: string;
  url: string;
  title?: string;
  duration?: number; // seconds
  /** Caption target language code (vi default). Legacy jobs: undefined = en. */
  targetLang?: string;
  /** Domain memory pack slug used for this job. */
  domainPack?: string;
  status: JobStatus;
  step: string; // human-readable current step
  progress: number; // 0..1 overall
  error?: string;
  logTail?: string;
  createdAt: number;
  updatedAt: number;
  artifacts: JobArtifacts;
}
