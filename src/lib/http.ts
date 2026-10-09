import { NextResponse } from "next/server";
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new Error("Invalid request origin");
}
export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json(
    { error: message },
    {
      status:
        message === "Unauthorized"
          ? 401
          : message === "Invalid request origin"
            ? 403
            : 400,
    },
  );
}
