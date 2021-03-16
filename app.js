var elastic = require('./elastic');

var restify = require('restify');
var server = restify.createServer({name: 'opennms-stats'});

server
  .use(restify.plugins.fullResponse())
  .use(restify.plugins.bodyParser());

server.get('/ping', function (req, res, next) {
  res.send({message: 'ok'});
});

server.post('/usage-report', function (req, res, next) {
  var report = req.body;

  console.log('Report received: ', report);
  elastic.saveReport(report);

  res.send({message: 'ok'});
});

server.use(function(err, req, res, next) {
  if (err) {
    console.error("Error!", err.toString());
    console.error(err.stack);
    res.status(500).send('Error!');
  }
});

server.listen(3542, function () {
  console.log('%s listening at %s', server.name, server.url);
});
