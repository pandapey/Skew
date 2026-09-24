import mongoose from 'mongoose'

import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

export async function connectDB(uri) {
  try {
    mongoose.set('strictQuery', true)

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    })

    console.log('MongoDB Connected')
    console.log('Database Name:', mongoose.connection.db.databaseName)

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
