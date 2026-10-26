/**
 * One-off import of historical usage reports from the Elasticsearch
 * opennms_log index into PostgreSQL.
 *
 * Usage (after `npm run build-only`):
 *
 *   ELASTIC_BASE_URL=http://elasticsearch:9200 DATABASE_URL=postgres://... \
 *     node dist/scripts/import-from-elasticsearch.js [index-name]
 *
 * The index defaults to opennms_log. The script scrolls the index oldest
 * first, reverses the field-mapping workaround the old handler applied
 * (nodesBySySOid maps were stored as arrays of {oid, value}), and saves
 * each document with its original @timestamp as received_at. The
 * opennms_system index is not imported: it only ever held the latest
 * report per system, which the system table derives from the log.
 *
 * Re-running the import inserts duplicates. Run it once, against an
 * empty usage_report table.
 */
import axios from 'axios';
import { Store } from '../store';

const MANGLED_FIELDS: Record<string, string> = {
    AllNodesBySysOid: 'nodesBySysOid',
    AllNodesWithDeviceConfigBySysOid: 'nodesWithDeviceConfigBySysOid',
};

interface Hit {
    _id: string;
    _source: Record<string, unknown>;
}

function unmangle(source: Record<string, unknown>): { report: Record<string, unknown>; receivedAt: Date | undefined } {
    const report: Record<string, unknown> = { ...source };
    const timestamp = report['@timestamp'];
    delete report['@timestamp'];
    const receivedAt = typeof timestamp === 'number' ? new Date(timestamp)
        : typeof timestamp === 'string' ? new Date(timestamp)
        : undefined;

    for (const [mangled, original] of Object.entries(MANGLED_FIELDS)) {
        const entries = report[mangled];
        if (Array.isArray(entries)) {
            const map: Record<string, unknown> = {};
            for (const entry of entries) {
                if (entry && typeof entry === 'object' && 'oid' in entry) {
                    map[String((entry as { oid: unknown }).oid)] = (entry as { value: unknown }).value;
                }
            }
            report[original] = map;
        }
        delete report[mangled];
    }
    return { report, receivedAt };
}

async function main() {
    const index = process.argv[2] ?? 'opennms_log';
    const baseURL = process.env.ELASTIC_BASE_URL ?? 'http://localhost:9200';
    const es = axios.create({ baseURL, headers: { 'Content-type': 'application/json' } });
    const store = new Store();
    await store.migrate();

    let imported = 0;
    let skipped = 0;
    const started = Date.now();

    let response = await es.post(`/${index}/_search?scroll=5m`, {
        size: 1000,
        sort: [{ '@timestamp': 'asc' }],
        query: { match_all: {} },
    });
    let scrollId: string = response.data._scroll_id;
    const total = response.data.hits.total?.value ?? response.data.hits.total;
    console.log(`Importing ${total} documents from ${baseURL}/${index}`);

    try {
        while (response.data.hits.hits.length > 0) {
            for (const hit of response.data.hits.hits as Hit[]) {
                const { report, receivedAt } = unmangle(hit._source);
                try {
                    await store.saveReport(report, receivedAt);
                    imported++;
                } catch (e) {
                    skipped++;
                    console.warn(`Skipped document ${hit._id}: ${(e as Error).message}`);
                }
            }
            console.log(`  ${imported} imported, ${skipped} skipped`);
            response = await es.post('/_search/scroll', { scroll: '5m', scroll_id: scrollId });
            scrollId = response.data._scroll_id;
        }
    } finally {
        await es.delete('/_search/scroll', { data: { scroll_id: scrollId } }).catch(() => undefined);
        await store.close();
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`Done: ${imported} imported, ${skipped} skipped in ${seconds}s`);
}

main().catch((e) => {
    console.error('Import failed', e);
    process.exit(1);
});
