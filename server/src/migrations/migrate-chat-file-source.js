import mongoose from 'mongoose'
import { FileItem } from '../models/fileModels.js'

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) throw new Error('MONGO_URI is required (set it in server/.env)')

await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })

const result = await FileItem.updateMany(
  { url: { $regex: '^/chat-uploads/' }, source: { $ne: 'chat' } },
  { $set: { source: 'chat' } }
)

console.log(`chat-uploads FileItems backfilled to source:'chat': matched=${result.matchedCount} modified=${result.modifiedCount}`)
console.log('general files left untouched (url not under /chat-uploads/)')

await mongoose.disconnect()
