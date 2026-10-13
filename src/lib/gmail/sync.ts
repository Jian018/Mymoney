import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizedClient,
  connection,
  gmailGet,
  message,
  privateDb,
  reconnect,
  ReconnectError,
} from "./server";
import { likelyFinancial, parseMessage, searchQuery } from "./parser";
import type { ExpenseCandidate } from "./types";
export async function synchronize(
  db: SupabaseClient,
  ownerId: string,
  requestId: string,
) {
  const admin = privateDb();
  const started = await admin.rpc("gmail_start_sync", {
    p_request: requestId,
    p_owner: ownerId,
  });
  if (started.error) throw new Error(started.error.message);
  const runId = String(started.data.id);
  if (started.data.existing) return { id: runId, existing: true };
  const c = await connection(db, ownerId);
  const finish = async (status: string, text: string) => {
    const r = await admin.rpc("gmail_finish_sync", {
      p_run: runId,
      p_status: status,
      p_message: text,
      p_owner: ownerId,
    });
    if (r.error)
      throw new Error(
        "Could not finalize scan. Saved records are safe; refresh the status.",
      );
  };
  const commit = async (
    id: string,
    result: string,
    candidate: ExpenseCandidate | null = null,
  ) => {
    const r = await admin.rpc("gmail_commit_message", {
      p_run: runId,
      p_message: id,
      p_result: result,
      p_candidate: candidate,
      p_owner: ownerId,
    });
    if (r.error)
      throw new Error(
        "Could not save scan results. Refresh status and retrieve again safely.",
      );
  };
  if (!c || c.connection_status !== "connected") {
    await finish("failed", "Reconnect Gmail before retrieving email data.");
    return { id: runId };
  }
  const now = Date.now(),
    from = now - 7 * 24 * 60 * 60 * 1000,
    deadline = now + 210_000;
  let processedNew = 0,
    partial = false,
    failures = 0;
  try {
    const token = await authorizedClient(c);
    let pageToken = "";
    const seenPages = new Set<string>();
    const seenMessages = new Set<string>();
    if (!partial)
      do {
        if (Date.now() > deadline) {
          partial = true;
          break;
        }
        const list = await gmailGet<{
          messages?: { id: string }[];
          nextPageToken?: string;
        }>(token, "messages", {
          q: searchQuery(from, now),
          maxResults: "100",
          ...(pageToken ? { pageToken } : {}),
        });
        const ids = (list.messages ?? [])
          .map((x) => x.id)
          .filter((id) => {
            if (seenMessages.has(id)) return false;
            seenMessages.add(id);
            return true;
          });
        // Look up only this Google page, not the user's entire historical inbox.
        // A failed message is deliberately retryable on the next explicit scan.
        const processed = new Set<string>();
        if (ids.length) {
          const p = await db
            .from("gmail_processed_messages")
            .select("gmail_message_id")
            .eq("user_id", ownerId)
            .eq("google_account_id", c.google_account_id)
            .in("gmail_message_id", ids)
            .neq("processing_status", "failed");
          if (p.error)
            throw new Error("Could not load processed-message history.");
          p.data?.forEach((x) => processed.add(x.gmail_message_id));
        }
        for (let offset = 0; offset < ids.length; offset += 4) {
          if (Date.now() > deadline || processedNew >= 200) {
            partial = true;
            break;
          }
          const batch = ids.slice(offset, offset + 4);
          const outcomes = await Promise.all(
            batch.map(async (id) => {
              if (processed.has(id))
                return { id, result: "already", candidate: null };
              try {
                const metadata = await message(token, id, "metadata"),
                  received = Number(metadata.internalDate);
                if (!Number.isFinite(received))
                  return { id, result: "failed", candidate: null };
                if (
                  received < from ||
                  received > now ||
                  !likelyFinancial(metadata)
                )
                  return { id, result: "ignored", candidate: null };
                const full = await message(token, id, "full");
                const candidate = parseMessage(full);
                const amounts = candidate.evidence
                  .detected_amounts as unknown[];
                if (!amounts.length)
                  return { id, result: "failed", candidate: null };
                return { id, result: "candidate", candidate };
              } catch (error) {
                if (error instanceof ReconnectError) throw error;
                return { id, result: "failed", candidate: null };
              }
            }),
          );
          for (const outcome of outcomes) {
            await commit(outcome.id, outcome.result, outcome.candidate);
            if (outcome.result !== "already") processedNew++;
            if (outcome.result === "failed") failures++;
          }
        }
        if (partial) break;
        pageToken = list.nextPageToken ?? "";
        if (pageToken && seenPages.has(pageToken))
          throw new Error(
            "Gmail pagination could not be completed. Retrieve again.",
          );
        seenPages.add(pageToken);
      } while (pageToken);
    await finish(
      partial || failures ? "partial" : "completed",
      partial
        ? "Scan reached its time/message limit. Only part of the last seven days was examined. Retrieve again to continue; processed messages are skipped."
        : failures
          ? "Some messages could not be interpreted or retrieved. They remain retryable; inspect results and retrieve again."
          : "Requested rolling seven-day email search completed. Emails without receipts cannot be recovered through Gmail.",
    );
  } catch (error) {
    const revoked = error instanceof ReconnectError;
    if (revoked) await reconnect(c);
    await finish(
      "failed",
      error instanceof Error
        ? error.message
        : "Gmail scan failed. Retrieve again safely.",
    );
  }
  return { id: runId };
}
