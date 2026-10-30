-- Identity of the source document for rows created by the Elasticsearch
-- import ("<index>/<_id>"). NULL for reports received directly. The unique
-- index lets the import be re-run or resumed without duplicating rows.

ALTER TABLE usage_report ADD COLUMN import_id text;

CREATE UNIQUE INDEX usage_report_import_id_idx
    ON usage_report (import_id)
    WHERE import_id IS NOT NULL;
