# usage-stats-handler

## How to test

* Make sure the node.js installed on the system
* Change to the project folder and run the following command

```shell
npm install
```

* Start elastic search docker container first

```shell
docker run -d -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:7.6.2
```

* Run the following command to start the server

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

```shell
npm start  
```
