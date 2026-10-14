# Time Keeper — Discord Activity

Time Keeper is an embedded Discord app for entering weekly shop hours. Managers launch it from Discord's App Launcher, and the complete interface opens inside Discord on desktop, web, or mobile. Cloudflare Workers provides the always-on backend and static hosting; Cloudflare D1 stores the shops, rosters, manager assignments, and hours.

## What it does

- Runs inside Discord using the official Embedded App SDK.
- Identifies the manager from their Discord account—there is no separate login.
- Shows managers only the shop or shops assigned to their Discord user ID.
- Keeps up to 8 regular employees on each shop roster.
- Lets managers enter weekly hours in quarter-hour increments.
- Adds an employee from another shop as week-specific cover staff.
- Gives administrators a setup screen for shops, employees, and managers.
- Deploys from GitHub to Cloudflare whenever `main` changes.

The first database migration creates the sample **Hillcrest** shop with Shane, Casey, and Dennis.

## Local browser preview

The real Activity authorization handshake only runs inside Discord. A safe demo mode is included for ordinary browser layout testing.

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Copy `.dev.vars.example` to `.dev.vars`, keep `DEMO_MODE="true"`, and use a long local-only `SESSION_SECRET`.

3. Prepare the local database and start the Cloudflare preview:

   ```sh
   pnpm db:local
   pnpm dev
   ```

4. Open `http://localhost:8787`. Demo mode grants admin access and must remain `false` in production.

## Production setup

### 1. Create the Cloudflare D1 database

Log in to Wrangler, then run:

```sh
pnpm exec wrangler d1 create time-keeper-db
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

### 2. Create the Discord app

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create an application named **Time Keeper**.
2. Upload `public/time-keeper-logo.png` as the icon and `public/time-keeper-banner.png` as the profile banner.
3. Under **Installation**, support both User Install and Guild Install.
4. Under **OAuth2**, add `https://127.0.0.1` as the placeholder redirect URI. The Embedded App SDK handles the in-Discord redirect.
5. Copy the Application ID and Client Secret.

### 3. Configure and deploy Cloudflare

Keep `DEMO_MODE` set to `false` in `wrangler.jsonc`, then store the private values in Cloudflare:

```sh
pnpm exec wrangler secret put DISCORD_CLIENT_ID
pnpm exec wrangler secret put DISCORD_CLIENT_SECRET
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ADMIN_DISCORD_IDS
pnpm db:remote
pnpm deploy
```

`ADMIN_DISCORD_IDS` accepts one Discord user ID or a comma-separated list. These users can create shops and assign managers. `SESSION_SECRET` should be a new long random value.

The final command prints the public `workers.dev` hostname. Keep it for the next step.

### 4. Turn on the Discord Activity

Back in the Discord Developer Portal:

1. Open **Activities → URL Mappings**.
2. Add a mapping with prefix `/` and target set to the Cloudflare Worker hostname without `https://`.
3. Open **Activities → Settings** and enable Activities.

Discord automatically creates the **Launch** Entry Point command. Time Keeper will then appear in the Discord App Launcher for the application owner and members of its developer team. Discord limits an undistributed Activity to those people during development.

### 5. Connect GitHub deployment

Push this folder to a GitHub repository. Add these repository Actions secrets:

- `CLOUDFLARE_API_TOKEN` — a token allowed to edit Workers and D1.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

The included `.github/workflows/deploy.yml` type-checks the code, runs tests, applies D1 migrations, builds the Activity, and deploys on every push to `main`.

## Manager setup

Launch Time Keeper in Discord with an account listed in `ADMIN_DISCORD_IDS`, then open **Shop setup**:

1. Add a shop.
2. Add up to eight employees and choose each person's home shop.
3. Enter the manager's name and Discord user ID, then assign the shop.

When that manager launches Time Keeper from Discord, the Worker verifies the signed Activity session and returns only their assigned shop data.

## Useful commands

```sh
pnpm check       # Type-check the Worker
pnpm test        # Run domain tests
pnpm build       # Bundle the Discord Activity
pnpm dev         # Build and start a local Cloudflare preview
pnpm db:local    # Apply migrations locally
pnpm db:remote   # Apply migrations in production
pnpm deploy      # Build and deploy to Cloudflare
```

## Security notes

- Discord authorization occurs through the official Embedded App SDK.
- The OAuth authorization code is exchanged on the Worker, so the Client Secret never reaches the Activity UI.
- The short-lived Discord access token is used only to authenticate the Activity SDK.
- API calls use a short-lived HMAC-signed app token tied to the Discord user ID.
- Manager authorization is checked on the Worker for every read and write.
- Admin access is controlled by `ADMIN_DISCORD_IDS`, never by browser state.
- `.dev.vars`, Discord secrets, and Cloudflare credentials are excluded from Git.
