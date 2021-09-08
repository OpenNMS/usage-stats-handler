# usage-stats-handler

##Start elastic search docker container first 
```
docker run -d -p 9200:9200 -p 9300:9300 -e "discovery.type=single-node" docker.elastic.co/elasticsearch/elasticsearch:7.6.2
```
## Running

```
pm2 start app.js 
```
