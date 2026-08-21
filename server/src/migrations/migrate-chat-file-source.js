// PHASE: EMPLOYEE CHAT ATTACHMENT PRIVACY — backfill `source: 'chat'` on FileItem
// records whose bytes live under /chat-uploads/ (i.e. attachments sent through
// Chat BEFORE the source field existed). Idempotent: records already tagged, or
// records that point into the general /uploads dir, are never touched.
//
// Without this migration those legacy chat attachments would keep showing up in
// the general Files module after the exclusion filter lands.
//
// Run from server/:  node src/migrations/migrate-chat-file-source.js
import mongoose from 'mongoose'
import { FileItem } from '../models/fileModels.js'

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0'

await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })

const result = await FileItem.updateMany(
  { url: { $regex: '^/chat-uploads/' }, source: { $ne: 'chat' } },
  { $set: { source: 'chat' } }
)

console.log(`chat-uploads FileItems backfilled to source:'chat': matched=${result.matchedCount} modified=${result.modifiedCount}`)
console.log('general files left untouched (url not under /chat-uploads/)')

await mongoose.disconnect()