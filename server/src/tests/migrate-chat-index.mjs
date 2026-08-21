// DROP the retired chat schema's unique partial index `memberIds_1` (idempotent).
//
// The `conversations` collection predates this phase's chatModels.js: its old
// schema used members[]/memberIds[]/lastMessage.content and left a UNIQUE
// partial index on memberIds (type: 'direct'). Under that index, any 'direct'
// document WITHOUT a memberIds field — i.e. every document the new schema
// creates — is indexed as memberIds:null, so creating a second direct
// conversation hits E11000 "Duplicate value for memberIds". The new schema is
// the only Conversation model in the codebase (grep: no code reads members/
// memberIds/lastMessage.content), so the index is dead weight AND a landmine.
// Legacy documents are left untouched (they are simply invisible to the new
// schema, whose queries filter on participants.user).
import mongoose from 'mongoose'
await mongoose.connect('mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0', { serverSelectionTimeoutMS: 8000 })
const col = mongoose.connection.db.collection('conversations')
const before = await col.indexes()
console.log('indexes before:', before.map((i) => i.name).join(', '))
if (before.some((i) => i.name === 'memberIds_1')) {
  await col.dropIndex('memberIds_1')
  console.log('dropped memberIds_1')
} else {
  console.log('memberIds_1 already absent (no-op)')
}
console.log('indexes after:', (await col.indexes()).map((i) => i.name).join(', '))
console.log('legacy docs left untouched:', await col.countDocuments({ memberIds: { $exists: true } }))
await mongoose.disconnect()