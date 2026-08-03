import mongoose from 'mongoose'

// Establish MongoDB connection. Fails fast with a clear message.
export async function connectDB(uri) {
  try {
    mongoose.set('strictQuery', true)

    await mongoose.connect(uri, {
      // Fail fast if we can't reach a server, then rely on Mongoose's built-in
      // auto-reconnect (bufferMaxEntries / reconnect logic) for transient drops.
      serverSelectionTimeoutMS: 5000,
    })

    console.log('MongoDB Connected')
    console.log('Database Name:', mongoose.connection.db.databaseName)

    // Report the collections that already exist in the database.
    const cols = await mongoose.connection.db.listCollections().toArray()
    console.log('Collections Found:', cols.length)
    if (cols.length) {
      console.log('  -', cols.map((c) => c.name).join(', '))
    }
    console.log('Connection Status: connected')

    // --- Connection lifecycle: log reconnect attempts, don't crash. ---
    mongoose.connection.on('error', (err) => {
      console.error(' MongoDB connection error:', err.message)
    })
    mongoose.connection.on('disconnected', () => {
      console.warn(' MongoDB disconnected — attempting to reconnect automatically…')
    })
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected')
    })

    return mongoose.connection
  } catch (err) {
    console.error(' MongoDB connection error:', err.message)
    process.exit(1)
  }
}

// Graceful shutdown used by server.js on SIGINT / SIGTERM.
// Closes the HTTP server (if provided) and the Mongoose connection, then exits.
export async function gracefulShutdown(httpServer) {
  console.log('\nShutting down gracefully…')
  try {
    if (httpServer && typeof httpServer.close === 'function') {
      await new Promise((resolve) => httpServer.close(resolve))
    }
    await mongoose.connection.close()
    console.log('MongoDB connection closed')
  } catch (err) {
    console.error('Error during shutdown:', err.message)
  } finally {
    process.exit(0)
  }
}
