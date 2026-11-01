# Deploy the OpenF1 relay (no command line)

The GitHub Pages site cannot send your OpenF1 login from the browser: OpenF1’s OPTIONS preflight on `/v1` returns 401 with no CORS headers. This relay is a tiny Azure Function that **answers OPTIONS itself**, **forwards your bearer token**, and **proxies GET `/v1/*` plus POST `/token`**. It does not store passwords or tokens.

CORS is locked to **https://candymanjl.github.io** only.

You need: an Azure account (consumption plan is fine / cheap when idle) and this GitHub repo.

## Fastest click path (about 10 minutes)

### 1. Create the Function App in the Azure Portal

1. Open [portal.azure.com](https://portal.azure.com) and sign in.
2. Search **Function App** → **Create**.
3. Fill in:
   - **Subscription** / **Resource group**: any (create a new group named `f1-pitwall` if asked).
   - **Function App name**: something unique, e.g. `f1pw-openf1-relay` (this becomes `https://NAME.azurewebsites.net`).
   - **Publish**: Code.
   - **Runtime stack**: Node.js.
   - **Version**: 20 LTS.
   - **Region**: a region near you.
   - **Operating System**: Windows (the in-portal editor works here).
   - **Hosting plan**: **Consumption (Serverless)**.
4. Click **Review + create** → **Create**. Wait until it says deployment succeeded, then **Go to resource**.

### 2. Allow the website’s origin

1. On the Function App, open **CORS** (search the left menu).
2. Remove `*` if it is listed.
3. Add exactly: `https://candymanjl.github.io`
4. Save.

### 3. Create one HTTP function and paste the code

1. Left menu → **Functions** → **Create**.
2. Choose **Develop in portal**.
3. Template: **HTTP trigger**.
4. Name: `openf1`.
5. Authorization level: **Anonymous**.
6. Create.
7. Open the new function → **Code + Test**.
8. Replace **everything** in `index.js` with the file from this repo: `relay/portal/index.js` (copy-paste the whole file).
9. Save.
10. Open **Integration** (or the function’s **function.json**). Set the HTTP trigger **Route template** to:

   `{*path}`

   Methods: GET, POST, OPTIONS. Save.

   If you cannot see route template, switch to the **Advanced editor** / `function.json` and paste `relay/portal/function.json` from this repo.

### 4. Copy the relay URL

The site wants the base **without** a trailing slash:

`https://YOUR-APP-NAME.azurewebsites.net/api`

Example: `https://f1pw-openf1-relay.azurewebsites.net/api`

That makes:

- REST: `https://…/api/v1/sessions?…`
- Sign-in: `https://…/api/token`

### 5. Point the pitwall at it

1. Open https://candymanjl.github.io/f1-pitwall/ (the **OpenF1 relay URL** box is part of this PR — it appears on the live site after this branch is merged).
2. **Settings**.
3. **OpenF1 relay URL** → paste `https://YOUR-APP-NAME.azurewebsites.net/api`
4. Sign in with your OpenF1 username and password.
5. Data mode: **Live**.
6. **Save**.

Live data then uses **REST polling through the relay every 4 seconds**. MQTT over WebSocket is skipped when a relay is set, because the OpenF1 MQTT broker is also awkward from a browser and would just delay the first update.

## Optional: GitHub Actions zip deploy (if the portal editor fights you)

1. Function App → **Get publish profile** (download the file).
2. GitHub → this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name: `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`
4. Value: paste the **entire** publish-profile file. Save.
5. GitHub → **Actions** → **Deploy OpenF1 relay** → **Run workflow** (this branch or `main` after merge).
6. Use the same relay URL as in step 4 above.

The workflow only uploads the `relay/` folder. It does not put tokens in Azure.

## Checks if something fails

- Function App → **CORS** must list `https://candymanjl.github.io` and not `*`.
- Relay URL in Settings must end with `/api` and must not include `/v1`.
- In Azure **Log stream**, you should see HTTP 204 on OPTIONS and then GET/POST. Tokens are never written to those logs by this code.
- A browser call from the GitHub Pages site should show `Access-Control-Allow-Origin: https://candymanjl.github.io` on the OPTIONS response.
