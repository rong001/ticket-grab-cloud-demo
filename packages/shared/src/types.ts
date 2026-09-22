export type Channel = "train" | "show" | "flight";

export type ProviderMode = "live" | "fixture";

export interface ShortlistItem {
  id: string;
  channel: Channel;
  title: string;
  subtitle?: string;
  datetime?: string;
  price?: number;
  currency?: string;
  availability: "available" | "limited" | "sold_out" | "unknown" | "waitlist";
  meta?: Record<string, unknown>;
}

export interface ShortlistResult {
  channel: Channel;
  provider: string;
  mode: ProviderMode;
  /** true only when items came from a successful live fetch */
  liveOk?: boolean;
  queriedAt: string;
  items: ShortlistItem[];
  notes?: string;
}

export interface TrainFields {
  from: string;
  to: string;
  date: string;
  timeWindow?: string;
  seatClass?: string;
  passengers?: number;
}

export interface ShowFields {
  eventName: string;
  city?: string;
  venue?: string;
  date?: string;
  saleOpenAt?: string;
  tier?: string;
  quantity?: number;
  /** Gewara/Maoyan/Dianping performance id for live detail fetch */
  performanceId?: string | number;
  /** Public detail URL (e.g. https://www.gewara.com/detail/498506) */
  detailUrl?: string;
  category?: string;
}

export interface FlightFields {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  cabin?: string;
  passengers?: number;
}

export type RequestFields = TrainFields | ShowFields | FlightFields;

export interface DiffResult {
  added: ShortlistItem[];
  removed: ShortlistItem[];
  changed: Array<{ before: ShortlistItem; after: ShortlistItem }>;
  availabilityImproved: ShortlistItem[];
}
