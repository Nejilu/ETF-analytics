import { ETF_CATALOG } from "@/data/catalog";

export function GET() {
  return Response.json(
    { data: ETF_CATALOG },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}
