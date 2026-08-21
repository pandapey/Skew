import dns from 'dns'
import mongoose from 'mongoose'

// MongoDB Atlas SRV DNS resolution.
// The system/Node resolver is currently pointing to 127.0.0.1,
// which causes querySrv ECONNREFUSED. Google/Cloudflare DNS
// successfully resolve the Atlas SRV records.
dns.setServers(['8.8.8.8', '1.1.1.1'])

// PHASE ADMIN ATTENDANCE (TASK 4): connection lifecycle transitions are genuine
// system events and were already being written to the console only. They are now
// also persisted so Admin -> System Log shows them. Every call is
// fire-and-forget and swallowed, so a log write can never affect connectivity.
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

// Establish MongoDB connection. Fails fast with a clear message.
export async function connectDB(uri) {
  try {
    mongoose.set('strictQuery', true)

    await mongoose.connect(uri, {
      // Fail fast if we can't reach a server, then rely on Mongoose's
      // built-in reconnect behavior for transient connection drops.
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

    systemLog(
      'INFO',
      `Connected to MongoDB database "${mongoose.connection.db.databaseName}" (${cols.length} collections)`,
      SYSTEM_LOG_SOURCES.DB
    )

    // --- Connection lifecycle: log reconnect attempts, don't crash. ---
    mongoose.connection.on('error', (err) => {
      console.error(' MongoDB connection error:', err.message)

      systemLog(
        'ERROR',
        `MongoDB connection error: ${err.message}`,
        SYSTEM_LOG_SOURCES.DB
      )
    })

    mongoose.connection.on('disconnected', () => {
      console.warn(
        ' MongoDB disconnected — attempting to reconnect automatically…'
      )

      // Best effort: this write itself needs the connection, so it will
      // usually fail while disconnected. It is kept because a brief drop
      // can still land.
      systemLog(
        'WARN',
        'MongoDB disconnected — attempting to reconnect automatically',
        SYSTEM_LOG_SOURCES.DB
      )
    })

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected')

      systemLog(
        'INFO',
        'MongoDB reconnected',
        SYSTEM_LOG_SOURCES.DB
      )
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

  systemLog(
    'INFO',
    'Server shutting down (signal received)',
    SYSTEM_LOG_SOURCES.API
  )

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