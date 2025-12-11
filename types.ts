export interface RecommendedBook {
  title: string;
  author: string;
  reason: string;
}

export interface BookInfo {
  title: string;
  author: string;
  description: string;
  genre?: string;
  publishedDate?: string;
  chapters: string[];
  recommendations: RecommendedBook[];
}

export interface Bookmark {
  id: string;
  bookTitle: string;
  chapter: string; // "Summary" or specific chapter name
  timestamp: number;
  createdAt: number;
}

export enum AppState {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  PROCESSING = 'PROCESSING',
  RESULT = 'RESULT',
  READING = 'READING', // Used when audio is ready to play
  ERROR = 'ERROR'
}

export interface ScanResult {
  image: string; // Base64
  info: BookInfo;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface SearchResult {
  text: string;
  links: GroundingChunk[];
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface StoredBook {
  info: BookInfo;
  coverImage: string | null; // Base64
  lastAccessed: number;
  isRead?: boolean;
}

// We cache tracks to avoid regeneration
export interface StoredTrack {
  bookTitle: string;
  trackName: string;
  text: string;
  audio: string; // Base64
  voice: string;
  language?: string;
  createdAt: number;
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export type Language = 'English' | 'Spanish' | 'French' | 'German' | 'Japanese' | 'Chinese' | 'Portuguese' | 'Hindi';