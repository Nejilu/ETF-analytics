import { getCatalog } from "@/data/services/catalog-service";

export function GET() {
  try {
    return Response.json(
      { data: getCatalog() },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "The ETF catalog is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
