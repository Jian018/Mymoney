import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/supabase/server";
import { checkOrigin, failure } from "@/lib/http";
import { deleteSchema, recordSchema } from "@/lib/validation";
export const runtime = "nodejs";
const tables = {
  transaction: "transactions",
  budget: "budgets",
  category: "categories",
};
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await requireOwner();
    const parsed = recordSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
    const record = parsed.data;
    if (record.entity === "checkin") {
      if (record.has_unrecorded_spending)
        throw new Error(
          "Record the outstanding expenses before completing this check-in.",
        );
      const { count, error } = await db
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("transaction_date", record.checkin_date)
        .eq("transaction_type", "expense");
      if (error) throw new Error(error.message);
      if (count === 0 && !record.zero_spending_confirmed)
        throw new Error("Explicitly confirm this was a zero-spending day.");
      const { entity, confirmed, zero_spending_confirmed, ...fields } = record;
      void entity;
      void confirmed;
      void zero_spending_confirmed;
      const result = await db
        .from("daily_checkins")
        .upsert(
          {
            ...fields,
            user_id: user.id,
            completed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,checkin_date" },
        )
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ id: result.data.id });
    }
    if (record.entity === "preferences") {
      const { entity, ...fields } = record;
      void entity;
      const result = await db
        .from("notification_preferences")
        .update(fields)
        .eq("user_id", user.id)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ id: result.data.id });
    }
    if (record.entity === "profile") {
      const { entity, ...fields } = record;
      void entity;
      const result = await db
        .from("profiles")
        .update(fields)
        .eq("id", user.id)
        .select("id")
        .single();
      if (result.error) throw new Error(result.error.message);
      return NextResponse.json({ id: result.data.id });
    }
    const { entity, id, ...fields } = record;
    if (entity === "transaction" && !id) {
      const requestId = record.request_id;
      if (!requestId) throw new Error("A transaction request ID is required.");
      const inserted = await db
        .from("transactions")
        .upsert(
          { ...fields, user_id: user.id },
          { onConflict: "user_id,request_id", ignoreDuplicates: true },
        );
      if (inserted.error) throw new Error(inserted.error.message);
      const saved = await db
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("request_id", requestId)
        .single();
      if (saved.error) throw new Error(saved.error.message);
      return NextResponse.json({ id: saved.data.id });
    }
    const result = id
      ? await db
          .from(tables[entity])
          .update(fields)
          .eq("id", id)
          .eq("user_id", user.id)
          .select("id")
          .single()
      : await db
          .from(tables[entity])
          .insert({ ...fields, user_id: user.id })
          .select("id")
          .single();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ id: result.data.id });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { db, user } = await requireOwner();
    const { entity, id } = deleteSchema.parse(await request.json());
    const result = await db
      .from(tables[entity])
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ id });
  } catch (error) {
    return failure(error);
  }
}
