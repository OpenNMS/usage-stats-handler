import {Httpclient} from "./httpclient";
import _ from "lodash";
import {AxiosResponse} from "axios";

export class Elastic {
    private httpclient: Httpclient = new Httpclient();

    public async saveReport(report: any): Promise<AxiosResponse> {
        report["@timestamp"] = new Date().getTime();
        let nodesSySysOid: any = {};
        _.each(report["nodesBySysOid"], (number, oid) => {
            const newID = oid.replace(/\./g, '_');
            nodesSySysOid[newID] = number;
        });
        report["nodesBySysOid"] = nodesSySysOid;
        return this.httpclient.post("/opennms_log/_doc/1", report);
    }

    public init() {
        this.updateLogIndex();
        this.updateSystemIndex();
    }

    private updateLogIndex() {
        const data = {
            "settings": {"number_of_shards": 1, "number_of_replicas": 0},
            "mappings": {
                "_source": {"enabled": true},
                "properties": {
                    "@timestamp": {type: 'date', "format": "epoch_millis"},
                    "systemId": {type: 'keyword', index: false},
                    "dynamic_templates": [
                        {
                            "strings": {
                                "match_mapping_type": "string",
                                "mapping": {
                                    "type": "keyword",
                                    "index": false,
                                    "omit_norms": true
                                }
                            }
                        }
                    ]
                }
            }
        };

        this.httpclient.put("/opennms_log_v1", data)
            .then(response => {
                if (response.status == 200) {
                    console.log();
                    const aliasData = {
                        "actions": [
                            {"add": {"index": "opennms_log_v1", "alias": "opennms_log"}}
                        ]
                    };
                    this.httpclient.post("/_aliases", aliasData)
                        .then(response => {
                            if (response.status != 200) {
                                console.log("create log alias failed", response.data.toString());
                            }
                        });
                } else {
                    console.log("Log Index creation failed", response.data.toString());
                }
            }).catch(reason => {
            console.log("failed to create log index", reason.response.data.error);
        });
    }

    private updateSystemIndex() {
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
                                "type": "string",
                                "index": true,
                                "omit_norms": true
                            }
                        }
                    }
                ]
            }
        };
        this.httpclient.put("/opennms_system_v1", data)
            .then(response => {
                if (response.status == 200) {
                    const aliasData = {
                        "actions": [
                            {"add": {"index": "opennms_system_v1", "alias": "opennms_system"}}
                        ]
                    };
                    this.httpclient.post("/_aliases", aliasData)
                        .then(response => {
                            if (response.status != 200) {
                                console.log("System Index creation failed", response.data.toString());
                            }
                        })
                } else {
                    console.log("System Index creation failed", response.data.toString());
                }
            }).catch(reason => {
            console.log("failed to create system index", reason.response.data.error);
        });
    }
}