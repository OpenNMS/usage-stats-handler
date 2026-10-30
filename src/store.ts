import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Maps a top-level key of the usage report payload to a column of
 * usage_report. Keys not listed here are still kept in the raw column.
 */
const TEXT_COLUMNS: Record<string, string> = {
    version: 'version',
    packageName: 'package_name',
    osName: 'os_name',
    osVersion: 'os_version',
    osArch: 'os_arch',
    databaseProductName: 'database_product_name',
    databaseProductVersion: 'database_product_version',
    sinkStrategy: 'sink_strategy',
    rpcStrategy: 'rpc_strategy',
    tssStrategies: 'tss_strategies',
};

const INTEGER_COLUMNS: Record<string, string> = {
    nodes: 'nodes',
    ipInterfaces: 'ip_interfaces',
    snmpInterfaces: 'snmp_interfaces',
    snmpInterfacesWithFlows: 'snmp_interfaces_with_flows',
    monitoredServices: 'monitored_services',
    events: 'events',
    alarms: 'alarms',
    situations: 'situations',
    minions: 'minions',
    monitoringLocations: 'monitoring_locations',
    users: 'users',
    groups: 'groups',
    pollsCompleted: 'polls_completed',
    eventLogsProcessed: 'event_logs_processed',
    coreFlowsPersisted: 'core_flows_persisted',
    coreNewtsSamplesInserted: 'core_newts_samples_inserted',
    coreQueuedUpdatesCompleted: 'core_queued_updates_completed',
    coreTssWritesCompleted: 'core_tss_writes_completed',
    flowCountPerSecond: 'flow_count_per_second',
    dcbSucceed: 'dcb_succeed',
    dcbFailed: 'dcb_failed',
    dcbWebUiEntries: 'dcb_web_ui_entries',
};

const BOOLEAN_COLUMNS: Record<string, string> = {
    inContainer: 'in_container',
};

/** Payload maps keyed by sysObjectID, and the kind they are stored under. */
const SYS_OID_MAPS: Record<string, string> = {
    nodesBySysOid: 'nodes',
    nodesWithDeviceConfigBySysOid: 'nodes_with_device_config',
};

export class ReportValidationError extends Error {}

export interface SavedReport {
    id: number;
    systemId: string;
    receivedAt: Date;
}

export interface SaveOptions {
    /** When the report arrived. Defaults to now. The Elasticsearch import passes the original timestamp. */
    receivedAt?: Date;
    /**
     * Identity of the source document for imported reports ("<index>/<_id>").
     * A report whose importId is already present is not inserted again.
     */
    importId?: string;
}

export class Store {
    private readonly pool: Pool;
    private readonly migrationsDir: string;

    /**
     * Connection settings come from DATABASE_URL when set, otherwise from the
     * standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
     * PGDATABASE) that the pg driver reads on its own.
     */
    constructor(options: { connectionString?: string; migrationsDir?: string } = {}) {
        const connectionString = options.connectionString ?? process.env.DATABASE_URL;
        this.pool = new Pool(connectionString ? { connectionString } : {});
        this.pool.on('error', (err) => console.error('Idle database client error', err));
        this.migrationsDir = options.migrationsDir ?? path.join(__dirname, '..', 'db', 'migrations');
    }

    /**
     * Applies every db/migrations/*.sql file that has not been applied yet,
     * in filename order, each in its own transaction.
     */
    public async migrate(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
                name       text        PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )`);
            // Serialize concurrent starters so only one applies a given file.
            await client.query('BEGIN');
            await client.query('LOCK TABLE schema_migration IN EXCLUSIVE MODE');
            const applied = new Set(
                (await client.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map(r => r.name)
            );
            const files = (await fs.readdir(this.migrationsDir)).filter(f => f.endsWith('.sql')).sort();
            for (const file of files) {
                if (applied.has(file)) {
                    continue;
                }
                const sql = await fs.readFile(path.join(this.migrationsDir, file), 'utf8');
                await client.query('SAVEPOINT migration');
                try {
                    await client.query(sql);
                    await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
                    await client.query('RELEASE SAVEPOINT migration');
                    console.log(`Applied migration ${file}`);
                } catch (e) {
                    await client.query('ROLLBACK TO SAVEPOINT migration');
                    throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
                }
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * Persists one usage report: inserts the usage_report row, the
     * per-sysObjectID counts, and creates or updates the system row.
     *
     * Returns null only when options.importId is given and a row with that
     * importId already exists; nothing is written in that case.
     *
     * @param report  the payload as POSTed
     */
    public async saveReport(report: unknown, options: SaveOptions = {}): Promise<SavedReport | null> {
        const { receivedAt, importId } = options;
        const systemId = Store.systemIdOf(report);
        const payload = Store.sanitize(report) as Record<string, unknown>;

        const columns: string[] = ['system_id', 'raw'];
        const values: unknown[] = [systemId, JSON.stringify(payload)];
        const placeholders: string[] = ['$1', '$2::jsonb'];
        const add = (column: string, value: unknown) => {
            columns.push(column);
            values.push(value);
            placeholders.push(`$${values.length}`);
        };

        if (receivedAt) {
            add('received_at', receivedAt);
        }
        if (importId) {
            add('import_id', importId);
        }
        for (const [key, column] of Object.entries(TEXT_COLUMNS)) {
            add(column, Store.asText(payload[key]));
        }
        for (const [key, column] of Object.entries(INTEGER_COLUMNS)) {
            add(column, Store.asInteger(payload[key]));
        }
        for (const [key, column] of Object.entries(BOOLEAN_COLUMNS)) {
            add(column, Store.asBoolean(payload[key]));
        }

        const sysOidRows: { kind: string; sysOid: string; count: number }[] = [];
        for (const [key, kind] of Object.entries(SYS_OID_MAPS)) {
            for (const [sysOid, count] of Store.asCountMap(payload[key]) ?? []) {
                sysOidRows.push({ kind, sysOid, count });
            }
        }
        const deviceConfigCounts = Store.asCountMap(payload['nodesWithDeviceConfigBySysOid']);
        add('nodes_with_device_config',
            deviceConfigCounts === null ? null : Store.asInteger([...deviceConfigCounts.values()].reduce((a, b) => a + b, 0)));

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const onConflict = importId ? 'ON CONFLICT (import_id) WHERE import_id IS NOT NULL DO NOTHING' : '';
            const inserted = await client.query<{ id: string; received_at: Date }>(
                `INSERT INTO usage_report (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
                 ${onConflict}
                 RETURNING id, received_at`,
                values
            );
            if (inserted.rows.length === 0) {
                await client.query('ROLLBACK');
                return null;
            }
            const id = Number(inserted.rows[0].id);
            const storedAt = inserted.rows[0].received_at;

            if (sysOidRows.length > 0) {
                await client.query(
                    `INSERT INTO report_sys_oid_count (report_id, kind, sys_oid, node_count)
                     SELECT $1, kind::sys_oid_kind, sys_oid, node_count
                     FROM unnest($2::text[], $3::text[], $4::bigint[]) AS t(kind, sys_oid, node_count)`,
                    [id, sysOidRows.map(r => r.kind), sysOidRows.map(r => r.sysOid), sysOidRows.map(r => r.count)]
                );
            }

            await Store.upsertSystem(client, systemId, storedAt, id);
            await client.query('COMMIT');
            return { id, systemId, receivedAt: storedAt };
        } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
        } finally {
            client.release();
        }
    }

    /**
     * The received_at of the newest imported report whose importId starts
     * with the given prefix, or null when none has been imported. Used by
     * the Elasticsearch import to resume where an earlier run stopped.
     */
    public async latestImportedAt(importIdPrefix: string): Promise<Date | null> {
        const result = await this.pool.query<{ latest: Date | null }>(
            `SELECT max(received_at) AS latest FROM usage_report WHERE import_id LIKE $1 || '%'`,
            [importIdPrefix.replace(/[\\%_]/g, '\\$&')]
        );
        return result.rows[0]?.latest ?? null;
    }

    public async close(): Promise<void> {
        await this.pool.end();
    }

    private static async upsertSystem(client: PoolClient, systemId: string, seenAt: Date, reportId: number) {
        // Written so that reports can be inserted out of order (the
        // Elasticsearch import does this) without the latest pointer or the
        // first/last seen timestamps going backwards.
        await client.query(
            `INSERT INTO system (system_id, first_seen_at, last_seen_at, report_count, latest_report_id)
             VALUES ($1, $2, $2, 1, $3)
             ON CONFLICT (system_id) DO UPDATE SET
                 first_seen_at    = LEAST(system.first_seen_at, EXCLUDED.first_seen_at),
                 last_seen_at     = GREATEST(system.last_seen_at, EXCLUDED.last_seen_at),
                 report_count     = system.report_count + 1,
                 latest_report_id = CASE WHEN EXCLUDED.last_seen_at >= system.last_seen_at
                                         THEN EXCLUDED.latest_report_id
                                         ELSE system.latest_report_id END`,
            [systemId, seenAt, reportId]
        );
    }

    private static systemIdOf(report: unknown): string {
        if (typeof report !== 'object' || report === null || Array.isArray(report)) {
            throw new ReportValidationError('Report must be a JSON object');
        }
        const systemId = (report as Record<string, unknown>)['systemId'];
        if (typeof systemId === 'number' && Number.isFinite(systemId)) {
            return String(systemId);
        }
        if (typeof systemId !== 'string' || systemId.trim() === '') {
            throw new ReportValidationError('Report is missing a systemId');
        }
        return Store.sanitize(systemId) as string;
    }

    /**
     * Returns a copy of the value that PostgreSQL will accept as jsonb and
     * text: NUL characters are removed and unpaired UTF-16 surrogates are
     * replaced with U+FFFD, in both strings and object keys. Everything else
     * is passed through unchanged, so unknown fields of any shape survive.
     */
    private static sanitize(value: unknown): unknown {
        if (typeof value === 'string') {
            return Store.sanitizeString(value);
        }
        if (Array.isArray(value)) {
            return value.map(v => Store.sanitize(v));
        }
        if (typeof value === 'object' && value !== null) {
            // Null prototype so a key literally named "__proto__" (legal in
            // JSON) is stored as an ordinary property instead of being lost.
            const out: Record<string, unknown> = Object.create(null);
            for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
                out[Store.sanitizeString(key)] = Store.sanitize(v);
            }
            return out;
        }
        return value;
    }

    private static sanitizeString(value: string): string {
        if (!/[\u0000\uD800-\uDFFF]/.test(value)) {
            return value;
        }
        return value
            .replace(/\u0000/g, '')
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
    }

    private static asText(value: unknown): string | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    /**
     * Coerces a value to an integer that fits a bigint column. Anything
     * else (non-numeric, out of range) yields null; the original value is
     * still present in the raw column.
     */
    private static asInteger(value: unknown): number | null {
        let n: number;
        if (typeof value === 'number') {
            n = value;
        } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
            n = Number(value);
        } else {
            return null;
        }
        if (!Number.isFinite(n)) {
            return null;
        }
        n = Math.trunc(n);
        // 2**63 itself is one past the bigint maximum; -(2**63) is the minimum.
        if (n >= 2 ** 63 || n < -(2 ** 63)) {
            return null;
        }
        return n;
    }

    private static asBoolean(value: unknown): boolean | null {
        if (typeof value === 'boolean') {
            return value;
        }
        if (value === 'true') return true;
        if (value === 'false') return false;
        return null;
    }

    /** Parses a {sysOid: count} object. Returns null when absent or malformed. */
    private static asCountMap(value: unknown): Map<string, number> | null {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return null;
        }
        const result = new Map<string, number>();
        for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
            const n = Store.asInteger(count);
            if (n !== null) {
                result.set(key, n);
            }
        }
        return result;
    }
}
