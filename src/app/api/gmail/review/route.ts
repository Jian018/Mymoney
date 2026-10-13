import { z } from "zod";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
const schema = z.object({
  id: z.uuid(),
  action: z.enum(["approve", "reject", "duplicate", "refund", "category"]),
  category_id: z.uuid().nullable().optional(),
  target_id: z.uuid().nullable().optional(),
  amount: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/)
    .optional(),
  currency: z.enum(["MYR", "SGD"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  merchant: z.string().trim().max(200).optional(),
  separate: z.boolean().optional(),
  cross_currency: z.boolean().optional(),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireOwner(),
      v = schema.parse(await request.json());
    const result = await db.rpc("gmail_review", {
      p_candidate: v.id,
      p_action: v.action,
      p_category: v.category_id ?? null,
      p_target: v.target_id ?? null,
      p_amount: v.amount ?? null,
      p_currency: v.currency ?? null,
      p_date: v.date ?? null,
      p_merchant: v.merchant ?? null,
      p_separate: v.separate ?? false,
      p_cross_currency: v.cross_currency ?? false,
    });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ result: result.data });
  } catch (error) {
    return failure(error);
  }
}
