// Ad-hoc SQL against the imported DB: node --no-warnings scripts/sql.js "SELECT ..."
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/eper84.sqlite', { readOnly: true });
for (const sql of process.argv.slice(2)) { console.log('>', sql); console.table(db.prepare(sql).all()); }
