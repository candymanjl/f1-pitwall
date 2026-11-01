const { app } = require("@azure/functions");
const { handleRelay } = require("../../handler");

app.http("openf1", {
  methods: ["GET", "POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (request) => {
    const url = new URL(request.url);
    const result = await handleRelay({
      method: request.method,
      path: url.pathname,
      search: url.search,
      header: (name) => request.headers.get(name) || "",
      body: async () => await request.text(),
    });
    return {
      status: result.status,
      headers: result.headers,
      body: result.body,
    };
  },
});
