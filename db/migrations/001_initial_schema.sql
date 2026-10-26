-- Initial schema for OpenNMS usage statistics.
--
-- usage_report holds one row per received report, with the fields the
-- dashboards aggregate promoted to typed columns and the complete payload
-- kept untouched in the raw jsonb column. system tracks one row per
-- reporting installation. report_sys_oid_count normalizes the two
-- "count by sysObjectID" maps for vendor and model breakdowns.

CREATE TABLE usage_report (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    system_id           text        NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),

    -- identity and environment
    version                  text,
    package_name             text,
    os_name                  text,
    os_version               text,
    os_arch                  text,
    in_container             boolean,
    database_product_name    text,
    database_product_version text,
    sink_strategy            text,
    rpc_strategy             text,
    tss_strategies           text,

    -- inventory counters
    nodes                      bigint,
    ip_interfaces              bigint,
    snmp_interfaces            bigint,
    snmp_interfaces_with_flows bigint,
    monitored_services         bigint,
    events                     bigint,
    alarms                     bigint,
    situations                 bigint,
    minions                    bigint,
    monitoring_locations       bigint,
    users                      bigint,
    groups                     bigint,

    -- throughput counters
    polls_completed               bigint,
    event_logs_processed          bigint,
    core_flows_persisted          bigint,
    core_newts_samples_inserted   bigint,
    core_queued_updates_completed bigint,
    core_tss_writes_completed     bigint,
    flow_count_per_second         bigint,

    -- device config backup
    dcb_succeed              bigint,
    dcb_failed               bigint,
    dcb_web_ui_entries       bigint,
    -- sum of the nodesWithDeviceConfigBySysOid map values, computed at insert
    nodes_with_device_config bigint,

    -- the payload exactly as it was POSTed
    raw                 jsonb       NOT NULL
);

CREATE INDEX usage_report_received_at_idx ON usage_report USING brin (received_at);
CREATE INDEX usage_report_system_time_idx ON usage_report (system_id, received_at DESC);
CREATE INDEX usage_report_version_idx     ON usage_report (version);

CREATE TABLE system (
    system_id        text        PRIMARY KEY,
    first_seen_at    timestamptz NOT NULL,
    last_seen_at     timestamptz NOT NULL,
    report_count     bigint      NOT NULL DEFAULT 0,
    latest_report_id bigint      NOT NULL REFERENCES usage_report (id)
);

CREATE TYPE sys_oid_kind AS ENUM ('nodes', 'nodes_with_device_config');

CREATE TABLE report_sys_oid_count (
    report_id   bigint       NOT NULL REFERENCES usage_report (id) ON DELETE CASCADE,
    kind        sys_oid_kind NOT NULL,
    sys_oid     text         NOT NULL,
    node_count  bigint       NOT NULL,
    PRIMARY KEY (report_id, kind, sys_oid)
);

CREATE INDEX report_sys_oid_count_oid_idx ON report_sys_oid_count (sys_oid, kind);

-- The latest full report for every installation, which is what the old
-- Elasticsearch "system" index held.
CREATE VIEW system_latest AS
SELECT s.first_seen_at,
       s.last_seen_at,
       s.report_count,
       r.*
FROM system s
JOIN usage_report r ON r.id = s.latest_report_id;
