# Running and verifying the API

Live base URL: https://cs409-mp3-14pp.onrender.com
API root: https://cs409-mp3-14pp.onrender.com/api

## Local run

Use Node 24. Run `npm ci`, copy `.env.example` to `.env`, set `MONGODB_URI` to the Atlas connection string, then run `npm start`. The server listens on `PORT` (default 3000) only after the database and indexes are ready. `npm run dev` uses Node's built-in watch mode.

Never commit `.env` or `atlas-credentials.env`. Both are ignored. The API does not expose connection strings or raw database errors.

## Tests

Run `npm test`. The integration suite uses `TEST_MONGODB_URI` when set, otherwise `MONGODB_URI`. It creates a uniquely named `mp3_test_*` database and deletes only that database when finished. The database account must allow creating and deleting that temporary database. A MongoDB replica set (including Atlas) is required for transactions.

Tests cover defaults and validation, status codes, field projection, filters and pagination, two-way assignment, user renaming, completed tasks, deletion, failed-write rollback, concurrent writes, form bodies, and CORS.

## Behavior notes

- POST returns 201; PUT and DELETE return 200. DELETE includes the standard `{message, data}` envelope. CORS OPTIONS returns 204 with no body.
- PUT resets omitted optional fields and preserves the server-created `dateCreated`.
- `count=true` counts all documents matching `where`, independently of pagination and projection. `limit=0` means unlimited. Task lists default to 100; user lists are unlimited.
- JSON bodies use strict field types. URL-encoded form bodies also accept `completed=true` and `completed=false` strings.
- Duplicate pending task ids are normalized to one entry. Assignment names are derived from the user when omitted and checked when supplied.
- Reference changes run in a transaction. A shared write lock prevents concurrent requests from leaving dangling references, including assignment of completed tasks during user deletion. This deliberately serializes mutations for this small course API.
- JavaScript query operators are rejected; ordinary MongoDB filters such as `$in`, `$gt`, `$or`, and `$regex` are supported through Mongoose.

## Render

The existing service tracks `PuanWang/CS409_MP3`, branch `main`. Use `npm ci --omit=dev` to build and `npm start` to launch. Set `MONGODB_URI` in Render's environment settings; never put its value in `render.yaml`. The project pins Node 24 through `.node-version` and `package.json`. The included `render.yaml` also describes a free service for reproducible setup.

After deployment, run `npm run submit`. The course grader URL is unchanged, and `API_URL` is set to the live base URL above. This command is only a self-check, not assignment submission. Google Form submission and the LLM usage record remain the student's manual steps.

## Technical references consulted

- Assignment contract: `README.md` and `FAQ.md` in this repository.
- Mongoose transactions: https://mongoosejs.com/docs/8.x/docs/transactions.html
- Mongoose connection transaction API: https://mongoosejs.com/docs/api/connection.html
- Render Node version selection: https://render.com/docs/node-version
- Render web services: https://render.com/docs/web-services
- Render blueprint configuration: https://render.com/docs/blueprint-spec
