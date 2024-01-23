import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { Elastic } from './elastic';
import config from 'config'
import { postCrmData, validateConfig } from './lib/userDataCollection/service';
import { CrmConfig } from './lib/userDataCollection/types';

const port = 3542;
const app = express();
app.use(express.json());
const headers = {
    "Content-type": "application/json"
};
const elastic = new Elastic();
elastic.init();

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    res.writeHead(500, headers);
    res.end("");
    next();
}
app.use(errorHandler);

app.get("/ping", async (request, response) => {
    response.writeHead(200, headers);
    response.end(JSON.stringify({message: "OK"}));
});

app.post("/usage-report", async (req, res) => {
    const report = req.body;
    console.log("Report opennms received: ", report);
    await elastic.saveReport(Elastic.OPENNMS_REPORT_NAME, report);
    res.writeHead(200, headers);
    res.end();
});

app.post("/hs-usage-report", async (req, res) => {
    const report = req.body;
    console.log("Report horizon stream received: ", report);
    await elastic.saveReport(Elastic.HORIZON_STREAM_REPORT_NAME, report);
    res.writeHead(200, headers);
    res.end();
});

/**
 * Receive user data from OpenNMS product (e.g. Horizon), send to CRM.
 */
app.post("/user-data-collection", async (req, res) => {
    const crmConfig = config.get<CrmConfig>('crmConfig');

    if (!validateConfig(crmConfig)) {
      console.error('Invalid CRM configuration', crmConfig);
      res.writeHead(500, headers);
      res.end();
    }

    const data = req.body;
    console.log("User data collection data received: ", data);

    let statusCode = 200;

    try {
      await postCrmData(crmConfig, data);
    } catch (e) {
      console.error('Error received posting CRM data: ', e);
      statusCode = 500;
    }

    res.writeHead(statusCode, headers);
    res.end();
});

app.listen(port, () => {
    console.log(`server is listening on ${port}`);
})
