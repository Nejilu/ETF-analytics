export function GET() {
  return Response.json(
    {
      status: "healthy",
      service: "index-lens",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
