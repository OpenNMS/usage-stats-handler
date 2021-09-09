# usage-stats-handler

##How to test
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
* Running elastictest.http in Intellij to test or using the curl to post report
* Using the following command to verify the report saved
```shell
curl -v -X POST --location "http://localhost:9200/opennms_log/_count?pretty"
curl -v -X POST --location "http://localhost:9200/opennms_system/_count?pretty"
```

## Running in the production environment

```shell
npm start  
```
