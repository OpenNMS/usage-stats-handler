import express from "express";
import type {ErrorRequestHandler} from "express";
import {Elastic} from "./elastic";

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
    let report = req.body;
    console.log("Report received: ", report);
    elastic.saveReport(report).then(response => {
        if(response.status == 200) {
            res.writeHead(200, headers);
            res.end();
        } else {
            res.writeHead(500, headers);
            res.end(`{${response.data}`)
        }
    }).catch(reason => {
        console.log("failed post report", reason);
        res.writeHead(500, headers);
        res.end(`{${reason.response}`);
    });
});


app.listen(port, () => {
    console.log(`server is listening on ${port}`);
})


