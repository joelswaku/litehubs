# LiteHubs production release guide

LiteHubs is deployed as three Railway services inside one Railway project:

1. **PostgreSQL** — the managed Railway PostgreSQL service.
2. **litehubs-api** — the private Express API built with `api/Dockerfile`.
3. **litehubs-web** — the public Next.js dashboard built with `web/Dockerfile`.

The browser talks only to the web service. The Next.js rewrite forwards `/api/v1/*`
to the private API service, which keeps authenticated cookie traffic same-origin.

## 1. Create the Railway services

Create one Railway project and add a PostgreSQL service. Then add these two services
from the **repository root** (`apps`):

| Service | Dockerfile | Port | Health check | Public domain |
| --- | --- | ---: | --- | --- |
| `litehubs-api` | `api/Dockerfile` | `5000` | `/api/v1/health` | No |
| `litehubs-web` | `web/Dockerfile` | `3000` | `/` | Yes |

Keep the source directory at the repository root for both services. Each Dockerfile
uses the root lockfile so the monorepo is installed consistently.

Give the API the private Railway service name `litehubs-api`. The web build then uses
`http://litehubs-api.railway.internal:5000` as `API_ORIGIN`.

## 2. API environment variables

Set these in Railway's **litehubs-api** service. Do not upload the local `.env` file.

```text
NODE_ENV=production
PORT=5000
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
FRONTEND_URL=https://<your-web-domain>
JWT_SECRET=<a unique random secret of 32+ characters>
REFRESH_TOKEN_SECRET=<a different unique random secret of 32+ characters>
MAIL_FROM_NAME=Congo Omega
MAIL_FROM_EMAIL=<a verified sending address>
SMTP_HOST=<your SMTP host>
SMTP_PORT=587
SMTP_USER=<your SMTP user>
SMTP_PASSWORD=<your SMTP password>
CLOUDINARY_CLOUD_NAME=<cloud name>
CLOUDINARY_API_KEY=<API key>
CLOUDINARY_API_SECRET=<API secret>
CLOUDINARY_FOLDER=litehubs
UPLOAD_MAX_FILE_SIZE_MB=10
AI_ENABLED=true
OPENAI_API_KEY=<server-side OpenAI API key>
OPEN_MODEL=gpt-5.6
AI_DAILY_REQUEST_LIMIT=20
```

Set the public web domain in `FRONTEND_URL` exactly, including `https://` and without
a trailing slash. This is required for authenticated cookies, CORS and email links.

## 3. Persistent private documents

Attach a Railway Volume to **litehubs-api** at:

```text
/app/storage
```

This is mandatory. Contracts, confidential files and generated PDFs are stored below
`/app/storage/company-documents` and are served only after LiteHubs checks the user's
organization and permission. Do not expose the volume as a public static directory.

Cloudinary remains required for images and media uploads. Its credentials stay only in
the API service variables.

## 4. Web build and runtime variables

Set these in **litehubs-web** before its build:

```text
API_ORIGIN=http://litehubs-api.railway.internal:5000
NODE_ENV=production
```

`API_ORIGIN` is a Docker build argument in `web/Dockerfile`; configure it as a Railway
build variable as well as a runtime variable so Next.js writes the correct private API
rewrite into its production build.

## 5. Safe release order

1. Create a database backup/snapshot.
2. Run `npm run db:migrate -- --status` against the Railway database and confirm the
   migration list.
3. Run `npm run db:migrate` once, using `DATABASE_ADMIN_URL`.
4. Deploy **litehubs-api** and wait for `GET /api/v1/health` to return `200`.
5. Deploy **litehubs-web** and attach its public domain.
6. Update `FRONTEND_URL` on the API to the final web domain, then redeploy the API.
7. Test sign-in, a document upload/download, an email invitation, a contract preview,
   and one organization-isolation check.

Never run migrations from both API replicas at once. Use one one-off migration run per
release.

## 6. Pre-release checks

Run these from the repository root:

```bash
npm run typecheck
npm run build
npm run db:migrate -- --status
```

The API fails fast in production when PostgreSQL, distinct JWT secrets, a verified
sender, SMTP, or enabled AI configuration is invalid. This is intentional.

## 7. Rollback

If a release is unhealthy, roll back the web and API services to the previous Railway
deployment. Do not restore the database merely to roll back application code: database
migrations are forward-only. Restore a backup only after confirming the impact and
following the operational recovery procedure.