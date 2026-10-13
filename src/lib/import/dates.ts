import { shiftDate, today } from "../finance";
export function requestedHistory(now = new Date()) {
  return { from: shiftDate(today(now), -7), to: shiftDate(today(now), -1) };
}
