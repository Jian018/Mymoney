import { z } from "zod";
import { cents, today } from "./finance";
const uuid = z.uuid();
const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((v) => {
    try {
      return cents(v) > 0n && cents(v) <= 99999999999999n;
    } catch {
      return false;
    }
  }, "Amount must be positive with at most two decimals.");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
const currency = z.enum(["MYR", "SGD"]);
export const recordSchema = z.discriminatedUnion("entity", [
  z.object({
    entity: z.literal("transaction"),
    id: uuid.optional(),
    request_id: uuid.optional(),
    transaction_type: z.enum(["income", "expense"]),
    category_id: uuid,
    amount,
    currency,
    description: z.string().trim().max(500),
    transaction_date: date.refine(
      (v) => v <= today(),
      "Future transactions are not supported.",
    ),
  }),
  z.object({
    entity: z.literal("budget"),
    id: uuid.optional(),
    category_id: uuid.nullable(),
    month: date.refine((v) => v.endsWith("-01"), "Use first day of month."),
    currency,
    limit_amount: amount,
  }),
  z.object({
    entity: z.literal("category"),
    id: uuid.optional(),
    name: z.string().trim().min(1).max(50),
    icon: z.enum([
      "food",
      "transport",
      "shopping",
      "bills",
      "entertainment",
      "salary",
      "other",
    ]),
    color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    transaction_type: z.enum(["income", "expense"]),
  }),
  z.object({
    entity: z.literal("checkin"),
    checkin_date: date.refine((v) => v <= today()),
    status: z.literal("completed"),
    has_unrecorded_spending: z.boolean(),
    has_impulse_purchase: z.boolean(),
    notes: z.string().trim().max(1000),
    confirmed: z.literal(true),
    zero_spending_confirmed: z.boolean(),
  }),
  z.object({
    entity: z.literal("preferences"),
    daily_reminder_enabled: z.boolean(),
    reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.literal("Asia/Singapore"),
  }),
  z.object({
    entity: z.literal("profile"),
    display_name: z.string().trim().min(1).max(80),
    timezone: z.literal("Asia/Singapore"),
    default_currency: currency,
  }),
]);
export const deleteSchema = z.object({
  entity: z.enum(["transaction", "budget", "category"]),
  id: uuid,
});
export function validPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      (u.hostname === "fcm.googleapis.com" ||
        u.hostname === "updates.push.services.mozilla.com" ||
        u.hostname === "web.push.apple.com" ||
        u.hostname.endsWith(".push.apple.com"))
    );
  } catch {
    return false;
  }
}
export const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2000)
    .refine(validPushEndpoint, "Unsupported push provider."),
  keys: z.object({
    p256dh: z
      .string()
      .regex(/^[A-Za-z0-9_-]+={0,2}$/)
      .min(80)
      .max(100),
    auth: z
      .string()
      .regex(/^[A-Za-z0-9_-]+={0,2}$/)
      .min(20)
      .max(30),
  }),
});
