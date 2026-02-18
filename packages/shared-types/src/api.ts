// Common API response wrapper
export interface ApiResponse<T> {
  data: T
  error: null
}

export interface ApiError {
  data: null
  error: {
    code: string
    message: string
    statusCode: number
  }
}

// Machine API types
export interface RegisterMachineRequest {
  name: string
  os: 'windows' | 'macos' | 'linux'
  hostname: string
  version: string
}

export interface StartSessionRequest {
  machineId: string
  command?: string // defaults to 'claude'
  workdir?: string
  env?: Record<string, string>
}

// Pagination
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
