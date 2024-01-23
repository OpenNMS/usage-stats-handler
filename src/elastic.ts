import {Httpclient} from "./httpclient";
import _ from "lodash";
import {AxiosResponse} from "axios";

export class Elastic {
    private static readonly ELASTIC_DEFAULT_BASE_URL = "http://localhost:9200";

    public static readonly OPENNMS_REPORT_NAME = "opennms";
    public static readonly HORIZON_STREAM_REPORT_NAME = "horizon_stream";

    private static readonly LOG_SUFFIX = "_log";
    private static readonly SYSTEM_SUFFIX = "_system";

    private static readonly REPORT_NAMES = [
        Elastic.OPENNMS_REPORT_NAME,
        Elastic.HORIZON_STREAM_REPORT_NAME
    ];

    private httpclient: Httpclient

    constructor() {
        let elasticBaseUrl = Elastic.ELASTIC_DEFAULT_BASE_URL;
        if (process.env.ELASTIC_BASE_URL) {
            elasticBaseUrl = process.env.ELASTIC_BASE_URL;
        }
        this.httpclient = new Httpclient(elasticBaseUrl);
    }

    public async saveReport(reportName: string, report: any) {
        report["@timestamp"] = new Date().getTime();
        const nodesSySysOid: any = {};
        _.each(report["nodesBySysOid"], (number, oid) => {
            const newID = oid.replace(/\./g, '_');
            nodesSySysOid[newID] = number;
        });
        report["nodesBySysOid"] = nodesSySysOid;
        try {
            await this.httpclient.post(`/${reportName}${Elastic.LOG_SUFFIX}/_doc`, report);
            console.log(`Successfully saved report to log index for report: ${reportName}`);
        } catch (e) {
            console.log(`Failed to save report to log index for report: ${reportName}`, e);
        }
        await this.saveReportToSystem(reportName, report);
    }

    public async saveReportToSystem(reportName: string, report: any) {
        const systemId = report.systemId;
        delete report.systemId;
        try {
            await this.httpclient.put(`/${reportName}${Elastic.SYSTEM_SUFFIX}/_doc/${systemId}`, report);
            console.log(`Successfully save report to system index for report: ${reportName}`);
        } catch (e) {
            console.log(`Failed to save report system index for report: ${reportName}`, e);
        }
    }

    public async init() {
        try {
            const response: AxiosResponse = await this.httpclient.get("/_cat/aliases");
            for (const report of Elastic.REPORT_NAMES) {
                const logAlias = `${report}${Elastic.LOG_SUFFIX}`;
                if (response.data.indexOf(logAlias) < 0) {
                    await this.createLogIndex(logAlias);
                }
                const systemAlias = `${report}${Elastic.SYSTEM_SUFFIX}`;
                if (response.data.indexOf(systemAlias) < 0) {
                    await this.createSystemIndex(systemAlias);
                }
            }
            console.log("Init completed.")
        } catch (error) {
            console.log("Failed to query indices.", error);
        }
    }

    private async createLogIndex(alias: string) {
        const data = {
            "settings": {"number_of_shards": 1, "number_of_replicas": 0},
            "mappings": {
                "_source": {"enabled": true},
                "properties": {
                    "@timestamp": {type: 'date', "format": "epoch_millis"},
                    "systemId": {type: 'keyword'}
                },
                "dynamic_templates": [
                    {
                        "strings": {
                            "match_mapping_type": "string",
                            "mapping": {
                                "type": "keyword",
                                "norms": false
                            }
                        }

                    }
                ]
            }
        };
        try {
            await this.httpclient.put(`/${alias}_v1`, data);
            console.log("Opennms log index created.");
            const aliasData = {
                "actions": [
                    {"add": {"index": `${alias}_v1`, "alias": alias}}
                ]
            };
            await this.createAlias(aliasData);
            console.log(`Alias ${alias} was created.`)
        } catch (error) {
            console.log(`Log index creation failed for alias ${alias}`, error);
        }
    }

    private async createSystemIndex(alias: string) {
        const data = {
            "settings": {"number_of_shards": 1, "number_of_replicas": 0},
            "mappings": {
                "_source": {"enabled": true},
                "properties": {
                    "@timestamp": {"type": "date", "format": "epoch_millis"}
                },
                "dynamic_templates": [
                    {
                        "strings": {
                            "match_mapping_type": "string",
                            "mapping": {
                                "type": "keyword",
                                "norms": false
                            }
                        }
                    }
                ]
            }
        };
        try {
            await this.httpclient.put(`/${alias}_v1`, data);
            console.log("System index was created")
            const aliasData = {
                "actions": [
                    {"add": {"index": `${alias}_v1`, "alias": alias}}
                ]
            };
            await this.createAlias(aliasData);
            console.log(`Alias ${alias} was created.`)
        } catch (error) {
            console.log(`system index creation failed for alias ${alias}`, error);
        }
    }

    private async createAlias(data: any): Promise<AxiosResponse> {
        return this.httpclient.post("/_aliases", data);
    }
}
