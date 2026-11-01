# Deploy the OpenF1 relay

The Function App already exists:

**https://f1-pitwall-relay-11686.azurewebsites.net**

Linux Consumption, Node 24, Functions v4. Platform CORS is `https://candymanjl.github.io`. This folder is a programming-model-v4 Node project: `package.json` + `host.json` (`routePrefix` is `""`) + `src/functions/openf1.js`. Paths are `/v1/…` and `/token`, not `/api/…`.

The function still answers OPTIONS in code (harmless next to platform CORS). It forwards `Authorization` and does not store or log tokens.

## Zip deploy

From the repo, after `az login`:

```
cd relay
npm install --omit=dev
zip -r ../relay.zip . -x "*.md" -x "*.test.js" -x "test-local.js" -x "local.js" -x ".funcignore" -x ".gitignore"
az functionapp deployment source config-zip --name f1-pitwall-relay-11686 --resource-group <resource-group> --src ../relay.zip
```

The zip must include `host.json`, `package.json`, `src/`, `handler.js`, and `node_modules/` (from that `npm install`).

## Point the pitwall at it

Settings → **OpenF1 relay URL** starts empty (OpenF1 is called directly). To use the relay, paste:

`https://f1-pitwall-relay-11686.azurewebsites.net`

No `/api`, no `/v1`, no trailing slash. Sign-in then goes to `/token` and REST to `/v1/…`. Live mode polls REST every 4 seconds (MQTT is skipped).
