# usage-stats-handler

A node/express web app for handling REST requests for OpenNMS usage statistics and user data.

## How to test

* Make sure that node.js is installed on the system
* Currently should use npm version 10 or higher; node version 18 or higher
* Change to the project folder and run the following command

```shell
npm install
```

* Start elastic search docker container first (don't need this if you are only testing the `user-data-collection` feature)

```shell
docker run -d -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:7.6.2
```

* Run the following command to compile the code and start the server

```shell
npm start
```

## Docker development

* Run Usage Stats Handler, Elasticsearch and Grafana

```shell
docker-compose up --build --abort-on-container-exit --remove-orphans --force-recreate
```

* Note: At times elasticsearch hangs on startup, to fix this either run it again and/or run

```shell
docker system prune
```

## Testing with Elasticsearch

* Running `test/opennms-test.http` in Intellij to test or using the curl to post report
* Using the following command to verify the report saved

```shell
curl -v -X POST --location "http://localhost:9200/opennms_log/_count?pretty"
curl -v -X POST --location "http://localhost:9200/opennms_system/_count?pretty"
```
* Visualise the grafana graph update with new values on a refresh 

## Running in the production environment

Add a file `config/production.json` which is a copy of `config/default.json` but with actual production values populated.

* Note: make sure not to check in `config/production.json` as it may contain credentials.

Then:

```shell
npm run start:prod
```

If you are running this in a different way (e.g. as part of a service), you can run `npm build-only` to build. Make sure to set the `NODE_ENV` environment variable to `production` (`export NODE_ENV=production`), and also set `NODE_CONFIG_DIR` to the `config` directory, then run the `dist/app.js` file:

```shell
export NODE_ENV=production
export NODE_CONFIG_DIR=/opt/usage-stats-handler/config
node dist/app.js
```

## REST endpoints

- `GET /` Base URL, but there's actually nothing at that path, it will return a 404
- `GET /ping` Get a basic ping response
- `POST /usage-report` Send an OpenNMS Horizon usage report
- `POST /hs-usage-report` Send an OpenNMS Horizon Stream usage report
- `POST /user-data-collection` Submit user data collection data
