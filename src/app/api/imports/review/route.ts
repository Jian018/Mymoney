import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
const schema = z.object({
  item: z.uuid(),
  action: z.enum(["new", "duplicate", "refund", "exclude"]),
  target: z.uuid().nullable().optional(),
  category: z.uuid().nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  currency: z.enum(["MYR", "SGD"]).optional(),
  amount: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/)
    .optional(),
  merchant: z.string().min(1).max(200).optional(),
  kind: z.enum(["expense", "income"]).optional(),
  separate_refund: z.boolean().optional(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireOwner();
    const v = schema.parse(await request.json());
    const { error } = await db.rpc("review_import", {
      p_item: v.item,
      p_action: v.action,
      p_target: v.target ?? null,
      p_category: v.category ?? null,
      p_date: v.date ?? null,
      p_currency: v.currency ?? null,
      p_amount: v.amount ?? null,
      p_merchant: v.merchant ?? null,
      p_kind: v.kind ?? null,
      p_separate_refund: v.separate_refund ?? false,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
