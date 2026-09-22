import type { Channel } from "../types.js";
import type { BookingAdapter } from "./types.js";
import { trainBookingAdapter } from "./train.js";
import { showBookingAdapter } from "./show.js";
import { flightBookingAdapter } from "./flight.js";

export * from "./types.js";
export { trainBookingAdapter, showBookingAdapter, flightBookingAdapter };

const bookingAdapters: Record<Channel, BookingAdapter> = {
  train: trainBookingAdapter,
  show: showBookingAdapter,
  flight: flightBookingAdapter,
};

export function getBookingAdapter(channel: Channel): BookingAdapter {
  const adapter = bookingAdapters[channel];
  if (!adapter) throw new Error(`No booking adapter for ${channel}`);
  return adapter;
}

export async function prepareCheckout(
  ...args: Parameters<BookingAdapter["prepareCheckout"]>
): ReturnType<BookingAdapter["prepareCheckout"]> {
  const channel = args[0].channel;
  return getBookingAdapter(channel).prepareCheckout(...args);
}

export async function submitOrder(
  ...args: Parameters<BookingAdapter["submitOrder"]>
): ReturnType<BookingAdapter["submitOrder"]> {
  const channel = args[0].channel;
  return getBookingAdapter(channel).submitOrder(...args);
}

export async function queryOrderStatus(
  ...args: Parameters<BookingAdapter["queryOrderStatus"]>
): ReturnType<BookingAdapter["queryOrderStatus"]> {
  const channel = args[0].channel;
  return getBookingAdapter(channel).queryOrderStatus(...args);
}

export * as train12306Booking from "./12306/index.js";
export {
  login12306,
  continueLogin12306,
  validateSession as validate12306Session,
  listPassengers as list12306Passengers,
  submitTrainOrder,
  queryTrainOrderStatus,
  serializeCookies as serialize12306Cookies,
  parseSessionBlob as parse12306SessionBlob,
} from "./12306/index.js";
