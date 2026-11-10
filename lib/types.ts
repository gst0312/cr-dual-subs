export interface Cue {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  text: string;
  /** translated text, filled in progressively */
  tr?: string;
}

export interface Track {
  locale: string;
  url: string;
  format: string;
}

export interface TrackList {
  subtitles: Track[];
  captions: Track[];
  audioLocale: string | null;
}

/** Messages posted between the MAIN-world script and the content script. */
export const MAIN_SOURCE = 'crds-main';
export const CONTENT_SOURCE = 'crds-content';
