import express from 'express';
import type { ErrorRequestHandler } from 'express';
import config from 'config'
import { Store, ReportValidationError } from './store';
import { postCrmData, validateConfig } from './lib/userDataCollection/service';
import { CrmConfig } from './lib/userDataCollection/types';

const port = 3542;
const app = express();
app.use(express.json({ limit: '5mb' }));
const headers = {
    "Content-type": "application/json"
};
const store = new Store();

app.get("/ping", async (request, response) => {
    response.writeHead(200, headers);
    response.end(JSON.stringify({message: "OK"}));
});

app.post("/usage-report", async (req, res) => {
    const report = req.body;
    console.log("Report opennms received: ", report);
    try {
        const saved = await store.saveReport(report);
        console.log(`Saved usage report ${saved.id} for system ${saved.systemId}`);
        res.writeHead(200, headers);
        res.end();
    } catch (e) {
        if (e instanceof ReportValidationError) {
            console.warn(`Rejected usage report: ${e.message}`);
            res.writeHead(400, headers);
            res.end(JSON.stringify({ error: e.message }));
            return;
        }
        console.error("Failed to save usage report", e);
        res.writeHead(500, headers);
        res.end();
    }
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
      return;
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

// Registered last so it also catches body-parser errors (malformed JSON).
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) {
        console.error("Unhandled request error", err);
    }
    res.writeHead(status, headers);
    res.end("");
}
app.use(errorHandler);

store.migrate()
    .then(() => {
        app.listen(port, () => {
            console.log(`server is listening on ${port}`);
        });
    })
    .catch((e) => {
        console.error("Database migration failed, not starting", e);
        process.exit(1);
    });
