import dns from 'node:dns'
import mongoose from 'mongoose'

import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

export async function connectDB(uri) {
  try {
    mongoose.set('strictQuery', true)

    // Fix for `querySrv ECONNREFUSED` on machines where Node's default DNS
    // resolver points at 127.0.0.1 (local proxy/VPN/AdGuard) which refuses
    // SRV lookups. PowerShell/OS resolution works, but Node's c-ares query
    // to 127.0.0.1 fails. Point Node at public DNS so `mongodb+srv://`
    // SRV/TXT lookups succeed. Safe: only affects this process.
    try {
      const current = dns.getServers()
      if (current.length === 0 || current.every((s) => s === '127.0.0.1' || s.startsWith('::'))) {
        dns.setServers(['8.8.8.8', '1.1.1.1'])
        console.log('Node DNS servers overridden to 8.8.8.8, 1.1.1.1 (was: ' + current.join(', ') + ')')
      }
    } catch {
      // ignore — fall through to default resolution
    }

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
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
    if (String(err.message).includes('querySrv')) {
      console.error(
        '\n Hint: `querySrv ECONNREFUSED` means Node could not do the Atlas SRV DNS lookup.\n' +
        ' - This fix already retries with 8.8.8.8/1.1.1.1 when your system DNS is 127.0.0.1.\n' +
        ' - If it still fails: check VPN/ad-blocker/firewall, or switch to a direct\n' +
        '   mongodb:// URI (no +srv) using the shard hosts, e.g.:\n' +
        '   mongodb://<user>:<pass>@ac-ubhvfzl-shard-00-00.aqys1ru.mongodb.net:27017,ac-ubhvfzl-shard-00-01.aqys1ru.mongodb.net:27017,ac-ubhvfzl-shard-00-02.aqys1ru.mongodb.net:27017/Skew?ssl=true&replicaSet=atlas-101xq2-shard-0&authSource=admin&retryWrites=true&w=majority\n'
      )
    }
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
