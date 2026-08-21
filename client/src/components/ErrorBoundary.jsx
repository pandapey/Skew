import { Component } from 'react'
import { ServerError } from '@/pages/error/ErrorPage'

// Top-level error boundary → renders the 500 page on render crashes.
export class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // In production, forward to a logging service here.
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) return <ServerError />
    return this.props.children
  }
}
