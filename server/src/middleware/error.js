// Central error handler + 404.
export function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` })
}

export function errorHandler(err, req, res, next) {
  console.error(err)

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}: ${err.value}` })
  }
  // Mongoose validation
  if (err.name === 'ValidationError') {
    return res.status(422).json({ message: Object.values(err.errors).map((e) => e.message).join(', ') })
  }
  // Duplicate key
  if (err.code === 11000) {
    return res.status(409).json({ message: `Duplicate value for ${Object.keys(err.keyValue).join(', ')}` })
  }
  // Multer upload errors
  if (err.name === 'MulterError') {
    return res.status(400).json({ message: `Upload error: ${err.message}` })
  }

  const status = err.statusCode || 500
  res.status(status).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}
