/**
 * Import of historical usage reports from an Elasticsearch log index into
 * PostgreSQL.
 *
 * Usage (after `npm run build-only`):
 *
 *   ELASTIC_BASE_URL=http://elasticsearch:9200 DATABASE_URL=postgres://... \
 *     node dist/scripts/import-from-elasticsearch.js [index-or-alias]
 *
 * The index defaults to opennms_log. An alias is resolved to its concrete
 * indices and each is imported in turn. Documents are read oldest first,
 * the field-mapping workaround the old handler applied is reversed
 * (nodesBySysOid maps were stored as arrays of {oid, value}), and each
 * document is saved with its original @timestamp as received_at. The
 * opennms_system index is not imported: it only ever held the latest
 * report per system, which the system table derives from the log.
 *
 * The import is safe to re-run and resumes automatically:
 *  - every imported row records "<index>/<_id>" in usage_report.import_id,
 *    and a document already present is skipped;
 *  - a run starts from the newest timestamp already imported for the index;
 *  - throttled (429) and transient (5xx, network) Elasticsearch failures
 *    are retried with backoff, honouring Retry-After; if the scroll is lost
 *    anyway, the search is reopened from the last imported timestamp.
 *
 * Tuning (environment variables, all optional):
 *   IMPORT_PAGE_SIZE      documents per scroll page        (default 500)
 *   IMPORT_PAGE_DELAY_MS  pause between pages              (default 0)
 *   IMPORT_MAX_RETRIES    retries per request              (default 10)
 *   IMPORT_MAX_RESTARTS   scroll reopen attempts per index (default 20)
 */
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Store } from '../store';

const MANGLED_FIELDS: Record<string, string> = {
    AllNodesBySysOid: 'nodesBySysOid',
    AllNodesWithDeviceConfigBySysOid: 'nodesWithDeviceConfigBySysOid',
};

const PAGE_SIZE = envInt('IMPORT_PAGE_SIZE', 500);
const PAGE_DELAY_MS = envInt('IMPORT_PAGE_DELAY_MS', 0);
const MAX_RETRIES = envInt('IMPORT_MAX_RETRIES', 10);
const MAX_RESTARTS = envInt('IMPORT_MAX_RESTARTS', 20);
const SCROLL_KEEPALIVE = '10m';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface Hit {
    _index: string;
    _id: string;
    _source: Record<string, unknown>;
}

interface ScrollResponse {
    _scroll_id: string;
    hits: { total?: { value: number } | number; hits: Hit[] };
}

interface Counters {
    imported: number;
    skipped: number;
    duplicate: number;
}

function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function unmangle(source: Record<string, unknown>): { report: Record<string, unknown>; receivedAt: Date | null } {
    const report: Record<string, unknown> = { ...source };
    const timestamp = report['@timestamp'];
    delete report['@timestamp'];
    let receivedAt: Date | null = null;
    if (typeof timestamp === 'number' || typeof timestamp === 'string') {
        const d = new Date(timestamp);
        if (!Number.isNaN(d.getTime())) {
            receivedAt = d;
        }
    }

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

/**
 * Runs an Elasticsearch request, retrying throttled and transient failures
 * with exponential backoff (1s, 2s, 4s ... capped at 60s, plus jitter), or
 * the Retry-After delay when the server sends one.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (e) {
            const err = e as AxiosError;
            const status = axios.isAxiosError(err) ? err.response?.status : undefined;
            const transient = axios.isAxiosError(err) && (status === undefined || RETRYABLE_STATUS.has(status));
            if (!transient || attempt >= MAX_RETRIES) {
                throw e;
            }
            const retryAfter = Number(err.response?.headers?.['retry-after']);
            const delay = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
            console.warn(`${what} failed (${status ?? err.code ?? err.message}); retry ${attempt + 1}/${MAX_RETRIES} in ${delay} ms`);
            await sleep(delay);
        }
    }
}

/** Resolves an index name or alias to the concrete indices behind it. */
async function resolveIndices(es: AxiosInstance, name: string): Promise<string[]> {
    const response = await withRetry(`resolve ${name}`, () => es.get(`/${encodeURIComponent(name)}`));
    return Object.keys(response.data).sort();
}

/**
 * Scrolls one concrete index from the given timestamp onward and saves
 * every document. Throws if a page cannot be fetched after retries; the
 * caller then reopens from the last imported timestamp.
 */
async function importFrom(es: AxiosInstance, store: Store, index: string, from: Date | null, counters: Counters): Promise<void> {
    const query = from
        ? { range: { '@timestamp': { gte: from.getTime(), format: 'epoch_millis' } } }
        : { match_all: {} };

    let response = await withRetry(`open scroll on ${index}`, () =>
        es.post<ScrollResponse>(`/${encodeURIComponent(index)}/_search?scroll=${SCROLL_KEEPALIVE}`, {
            size: PAGE_SIZE,
            sort: [{ '@timestamp': 'asc' }],
            query,
        })
    );
    let scrollId = response.data._scroll_id;
    const total = response.data.hits.total;
    const totalCount = typeof total === 'object' && total !== null ? total.value : total;
    console.log(`${index}: ${totalCount ?? '?'} documents${from ? ` since ${from.toISOString()}` : ''}`);

    try {
        while (response.data.hits.hits.length > 0) {
            for (const hit of response.data.hits.hits) {
                const { report, receivedAt } = unmangle(hit._source);
                if (receivedAt === null) {
                    // A row without its original timestamp would be stored as "now"
                    // and break resumption, so it is reported rather than imported.
                    counters.skipped++;
                    console.warn(`Skipped ${hit._index}/${hit._id}: no usable @timestamp`);
                    continue;
                }
                try {
                    const saved = await store.saveReport(report, { receivedAt, importId: `${hit._index}/${hit._id}` });
                    if (saved === null) {
                        counters.duplicate++;
                    } else {
                        counters.imported++;
                    }
                } catch (e) {
                    counters.skipped++;
                    console.warn(`Skipped ${hit._index}/${hit._id}: ${(e as Error).message}`);
                }
            }
            console.log(`  ${counters.imported} imported, ${counters.duplicate} already present, ${counters.skipped} skipped`);
            if (PAGE_DELAY_MS > 0) {
                await sleep(PAGE_DELAY_MS);
            }
            response = await withRetry(`scroll ${index}`, () =>
                es.post<ScrollResponse>('/_search/scroll', { scroll: SCROLL_KEEPALIVE, scroll_id: scrollId })
            );
            scrollId = response.data._scroll_id;
        }
    } finally {
        await es.delete('/_search/scroll', { data: { scroll_id: scrollId } }).catch(() => undefined);
    }
}

async function importIndex(es: AxiosInstance, store: Store, index: string, counters: Counters): Promise<void> {
    for (let restart = 0; ; restart++) {
        const from = await store.latestImportedAt(`${index}/`);
        try {
            await importFrom(es, store, index, from, counters);
            return;
        } catch (e) {
            if (restart >= MAX_RESTARTS) {
                throw e;
            }
            const err = e as AxiosError;
            console.warn(`${index}: scroll lost (${err.response?.status ?? err.message}); reopening from last imported timestamp (restart ${restart + 1}/${MAX_RESTARTS})`);
            await sleep(5000);
        }
    }
}

async function main() {
    const name = process.argv[2] ?? 'opennms_log';
    const baseURL = process.env.ELASTIC_BASE_URL ?? 'http://localhost:9200';
    const es = axios.create({ baseURL, headers: { 'Content-type': 'application/json' }, timeout: 120_000 });
    const store = new Store();
    await store.migrate();

    const counters: Counters = { imported: 0, skipped: 0, duplicate: 0 };
    const started = Date.now();
    try {
        const indices = await resolveIndices(es, name);
        console.log(`Importing from ${baseURL}: ${name} -> ${indices.join(', ')}`);
        for (const index of indices) {
            await importIndex(es, store, index, counters);
        }
    } finally {
        await store.close();
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`Done: ${counters.imported} imported, ${counters.duplicate} already present, ${counters.skipped} skipped in ${seconds}s`);
}

main().catch((e) => {
    console.error('Import failed', e);
    process.exit(1);
});
