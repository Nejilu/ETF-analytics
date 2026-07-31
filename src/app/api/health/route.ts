import { ensureLocalDatabase } from "@/db/bootstrap";
import { getSqlite } from "@/db/client";

export function GET() {
  ensureLocalDatabase();
  getSqlite().prepare("SELECT 1").get();

  return Response.json(
    {
      status: "healthy",
      service: "index-lens",
      version: "0.1.0",
      database: {
        status: "ready",
      },
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
