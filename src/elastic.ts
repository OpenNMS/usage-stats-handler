import {Httpclient} from "./httpclient";
import _ from "lodash";
import {AxiosResponse} from "axios";

export class Elastic {
    readonly ALIAS_SYSTEM = "opennms_system";
    readonly ALIAS_LOG = "opennms_log";
    private httpclient: Httpclient = new Httpclient();

    public async saveReport(report: any) {
        report["@timestamp"] = new Date().getTime();
        let nodesSySysOid: any = {};
        _.each(report["nodesBySysOid"], (number, oid) => {
            const newID = oid.replace(/\./g, '_');
            nodesSySysOid[newID] = number;
        });
        report["nodesBySysOid"] = nodesSySysOid;
        try {
            await this.httpclient.post("/opennms_log/_doc", report);
            console.log("Successfully saved report to log index");
        } catch (e) {
            console.log("Failed to save report to log index", e);
        }
        await this.saveReportToSystem(report);
    }

    public async saveReportToSystem(report: any) {
        const systemId = report.systemId;
        delete report.systemId;
        try {
            await this.httpclient.put(`/opennms_system/_doc/${systemId}`, report);
            console.log('Successfully save report to system index');
        } catch (e) {
            console.log('Failed to save report system index', e);
        }
    }

    public async init() {
        try {
            const response: AxiosResponse = await this.httpclient.get("/_cat/aliases");
            if (response.data.indexOf(this.ALIAS_LOG) < 0) {
                await this.createLogIndex();
            }
            if (response.data.indexOf(this.ALIAS_SYSTEM) < 0) {
                await this.createSystemIndex();
            }
        } catch (error) {
            console.log("Failed to query indices.", error);
        }
    }

    private async createLogIndex() {
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
            await this.httpclient.put("/opennms_log_v1", data);
            console.log("Opennms log index created.");
            const aliasData = {
                "actions": [
                    {"add": {"index": "opennms_log_v1", "alias": this.ALIAS_LOG}}
                ]
            };
            await this.createAlias(aliasData);
            console.log(`Alias ${this.ALIAS_LOG} was created.`)
        } catch (error) {
            console.log("Log index creation failed", error);
        }
    }

    private async createAlias(data: any): Promise<AxiosResponse> {
        return this.httpclient.post("/_aliases", data);
    }

    private async createSystemIndex() {
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
            await this.httpclient.put("/opennms_system_v1", data);
            console.log("System index was created")
            const aliasData = {
                "actions": [
                    {"add": {"index": "opennms_system_v1", "alias": this.ALIAS_SYSTEM}}
                ]
            };
            await this.createAlias(aliasData);
            console.log(`Alias ${this.ALIAS_SYSTEM} was created.`)
        } catch (error) {
            console.log("system index creation failed");
        }
    }
}
