# usage-stats-handler

A node/express web app for handling REST requests for OpenNMS usage statistics and user data.

Usage reports are stored in PostgreSQL. Each report is kept in full as a `jsonb`
document, with the fields the dashboards aggregate promoted to typed columns.
See [Data model](#data-model) below.

## How to test

* Make sure that node.js is installed on the system
* Requires Node.js 26 or higher (see `.nvmrc`) and the npm version bundled with it
* Change to the project folder and run the following command

```shell
npm install
```

* Start a PostgreSQL container first (don't need this if you are only testing the `user-data-collection` feature)

```shell
docker run -d --name usagestats-postgres -p 5432:5432 \
  -e POSTGRES_USER=usagestats -e POSTGRES_PASSWORD=usagestats -e POSTGRES_DB=usagestats \
  docker.io/library/postgres:16-alpine
```

* Run the following command to compile the code and start the server

```shell
export DATABASE_URL=postgres://usagestats:usagestats@localhost:5432/usagestats
npm start
```

The schema is created automatically on startup from the SQL files in `db/migrations`.
Files are applied in name order and recorded in the `schema_migration` table, so a
later schema change is just a new, higher-numbered file.

## Docker development

* Run Usage Stats Handler, PostgreSQL and Grafana

```shell
docker-compose up --build --abort-on-container-exit --remove-orphans --force-recreate
```

Grafana is available on http://localhost:3001 with the PostgreSQL datasource and the
OpenNMS Usage Report dashboard provisioned.

## Testing with PostgreSQL

* Run `test/opennms-test.http` in Intellij, or post a report with curl
* Use the following to verify the report was saved

```shell
psql postgres://usagestats:usagestats@localhost:5432/usagestats \
  -c 'SELECT id, system_id, received_at, version, nodes FROM usage_report ORDER BY id DESC LIMIT 5'
psql postgres://usagestats:usagestats@localhost:5432/usagestats \
  -c 'SELECT system_id, last_seen_at, report_count, version FROM system_latest'
```

* Visualise the grafana graph update with new values on a refresh

## Data model

| Table / view | Purpose |
|---|---|
| `usage_report` | One row per received report. `raw` holds the payload exactly as POSTed. `received_at` is when it arrived. Dashboard fields (`version`, `nodes`, `minions`, the `core_*` counters, ...) are typed columns. `nodes_with_device_config` is the sum of the `nodesWithDeviceConfigBySysOid` map. |
| `system` | One row per reporting installation: first and last seen, report count, and a pointer to its latest report. |
| `system_latest` | View joining `system` to its latest `usage_report` row. |
| `report_sys_oid_count` | The `nodesBySysOid` and `nodesWithDeviceConfigBySysOid` maps normalized to one row per report, kind and sysObjectID. |

Fields that are not promoted are still queryable from `raw`, for example
`raw->'services'` or `raw->>'databaseProductName'`. Promoting a field later is a
migration that adds the column and backfills it from `raw`.

## Importing history from Elasticsearch

The previous version of this service wrote to Elasticsearch. A one-off import of the
`opennms_log` index is available:

```shell
export ELASTIC_BASE_URL=http://elasticsearch:9200
export DATABASE_URL=postgres://usagestats:usagestats@localhost:5432/usagestats
npm run import:elasticsearch
```

It reverses the field mapping workaround the old handler applied, keeps each
document's original `@timestamp` as `received_at`, and rebuilds the `system` table.
Run it once against an empty database; re-running it inserts duplicates.

## Running in the production environment

Add a file `config/production.json` which is a copy of `config/default.json` but with actual production values populated.

* Note: make sure not to check in `config/production.json` as it may contain credentials.

Database connection settings come from the `DATABASE_URL` environment variable, or
from the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE`
variables when `DATABASE_URL` is not set.

Then:

```shell
npm run start:prod
```

If you are running this in a different way (e.g. as part of a service), you can run `npm build-only` to build. Make sure to set the `NODE_ENV` environment variable to `production` (`export NODE_ENV=production`), and also set `NODE_CONFIG_DIR` to the `config` directory, then run the `dist/app.js` file:

```shell
export NODE_ENV=production
export NODE_CONFIG_DIR=/opt/usage-stats-handler/config
export DATABASE_URL=postgres://user:password@host:5432/usagestats
node dist/app.js
```

The `db/migrations` directory must be present next to `dist` at runtime.

## REST endpoints

- `GET /` Base URL, but there's actually nothing at that path, it will return a 404
- `GET /ping` Get a basic ping response
- `POST /usage-report` Send an OpenNMS Horizon usage report. Returns 200 when stored, 400 when the body is not a JSON object with a `systemId`, 500 when the database write fails.
- `POST /user-data-collection` Submit user data collection data
