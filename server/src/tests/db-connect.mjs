// Shared DB bootstrap for e2e test scripts. The system/Node resolver points at
// 127.0.0.1, which breaks Atlas SRV resolution — the same dns.setServers
// override src/config/db.js applies. The MONGO_URI env var wins; otherwise the
// server/.env MONGO_URI is used, so the tests always hit the same database the
// running server uses.
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dns.setServers(['8.8.8.8', '1.1.1.1'])

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let fromEnv = null
try {
  const env = fs.readFileSync(path.resolve(__dirname, '../..', '.env'), 'utf8')
  fromEnv = env.split('\n').find((l) => l.startsWith('MONGO_URI='))?.split('=').slice(1).join('=')
} catch { /* .env absent — fall through to the default below */ }

export const TEST_MONGO_URI = process.env.MONGO_URI
  || fromEnv
  || 'mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0'