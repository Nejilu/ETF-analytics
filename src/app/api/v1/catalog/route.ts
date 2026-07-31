import { getCatalog } from "@/data/services/catalog-service";

export function GET() {
  return Response.json(
    { data: getCatalog() },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
