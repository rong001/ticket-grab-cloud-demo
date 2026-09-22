import type { Channel, ProviderMode, ShortlistResult } from "../types.js";

export interface AdapterSearchInput {
  channel: Channel;
  fields: Record<string, unknown>;
  mode?: ProviderMode;
}

export interface TicketAdapter {
  id: string;
  channel: Channel;
  search(input: AdapterSearchInput): Promise<ShortlistResult>;
}
