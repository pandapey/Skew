import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import { Project } from '../models/projectModels.js'
import { Client, ClientProject } from '../models/clientModels.js'

dotenv.config()

async function run() {
  await connectDB(process.env.MONGO_URI)
  console.log('Backfilling Project.clientId from Client.company / ClientProject ...')

  const clients = await Client.find({}).select('company clientId').lean()
  const byCompany = Object.fromEntries(clients.map(c => [String(c.company || '').toLowerCase().trim(), c.clientId]))
  const byProjectId = Object.fromEntries((await ClientProject.find({}).select('sourceProjectId clientId').lean()).map(cp => [String(cp.sourceProjectId), cp.clientId]))

  const projects = await Project.find({}).lean()
  let updated = 0
  let skipped = 0
  for (const p of projects) {
    if (p.clientId) { skipped++; continue }
    const fromMirror = p._id ? byProjectId[String(p._id)] : null
    const fromCompany = String(p.client || '').toLowerCase().trim() ? byCompany[String(p.client || '').toLowerCase().trim()] : null
    const nextId = fromMirror || fromCompany || ''
    if (!nextId) {
      console.warn(`  skip ${p.code || p._id} (${p.name}): no client match for "${p.client}"`)
      continue
    }
    await Project.updateOne({ _id: p._id }, { $set: { clientId: nextId } })
    console.log(`  ${p.code || p._id} -> ${nextId} (${p.client})`)
    updated++
  }

  console.log(`Done. Updated ${updated}, already linked ${skipped}, total ${projects.length}`)

  // Ensure indexes
  try { await Project.collection.createIndex({ clientId: 1 }) } catch {}
  await mongoose.disconnect()
  process.exit(0)
}

run().catch(async e => { console.error(e); await mongoose.disconnect(); process.exit(1) })
