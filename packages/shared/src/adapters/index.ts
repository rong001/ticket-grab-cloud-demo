import type { Channel, ProviderMode, ShortlistResult } from "../types.js";
import { routeChannel } from "../schemas/request.js";
import { train12306Adapter } from "./train12306.js";
import { showAdapter } from "./show.js";
import { flightAdapter } from "./flight.js";
import type { TicketAdapter } from "./types.js";

export * from "./types.js";
export * from "./liveMode.js";
export * from "./dataSources.js";
export { train12306Adapter, showAdapter, flightAdapter };
export {
  suggestShowWatch,
  uniqueTicketTiers,
  sessionsToItems,
  saleStatusLabel,
  mapShowAvailability,
  extractPerformanceId,
  resolveCityId,
  searchVenuesByCity,
  SHOW_CITY_IDS,
  CURATED_SHOW_VENUES,
} from "./show.js";

const adapters: Record<string, TicketAdapter> = {
  train12306: train12306Adapter,
  show: showAdapter,
  flight: flightAdapter,
};

export function getAdapter(channel: Channel): TicketAdapter {
  const id = routeChannel(channel);
  const adapter = adapters[id];
  if (!adapter) throw new Error(`No adapter for channel: ${channel}`);
  return adapter;
}

export async function searchTickets(
  channel: Channel,
  fields: Record<string, unknown>,
  mode?: ProviderMode
): Promise<ShortlistResult> {
  const adapter = getAdapter(channel);
  return adapter.search({ channel, fields, mode });
}
export {
  loadStationIndex,
  loadStationRecords,
  listStationsByCity,
  listTrainCities,
  parseStationRecords,
  resolveStationTelecode,
  stationLoadStatus,
  SEAT_COLUMNS,
} from "./train12306.js";
export type { StationRecord } from "./train12306.js";
