export type LimitKey = 'max_instances' | 'max_cpu' | 'max_memory_mb' | 'max_disk_gb' | 'max_snapshots' | 'traffic_gb' | 'max_domains'
export type Limits = Record<LimitKey, number | null>

export interface User {
  id: number
  username: string
  role: 'admin' | 'user'
  disabled: boolean
  mustChangePassword: boolean
  totpEnabled: boolean
  limits: Limits
  note: string
  createdAt: number
  lastLoginAt: number | null
}

export interface AdminUser extends User {
  usage: { instances: number; cpu: number; memoryMb: number; diskGb: number; domains: number }
}

export interface Usage {
  instances: number
  cpu: number
  memoryMb: number
  diskGb: number
}

export interface Image {
  id: string
  family: string
  name: string
  version: string
}

export interface Instance {
  id: string
  name: string
  userId: number
  image: Image
  cpu: number
  memoryMb: number
  diskGb: number
  status: string
  progress: string | null
  error: string | null
  busy: string | null
  sshPort: number | null
  sshHost: string | null
  ipv4: string | null
  ipv6: string | null
  hasSshKey: boolean
  trafficBlocked: boolean
  passwordPending: boolean
  createdAt: number
  owner?: { id: number; username: string }
}

export interface Detail {
  instance: Instance
  live: { status: string; memUsed: number; processes: number; ipv4: string | null; ipv6: string | null } | null
  traffic: { period: string; rx: number; tx: number; quotaGb: number | null }
  limits: { maxSnapshots: number | null }
  diskQuotaEnforced: boolean
}

export interface Point {
  at: number
  cpu: number
  memUsed: number
  memTotal: number
  diskUsed: number
  rx: number
  tx: number
  processes: number
}

export interface EventItem {
  id: number
  at: number
  level: string
  action: string
  message: string | null
  actor: string | null
  instanceId: string | null
  user: string | null
}

export interface Snapshot {
  name: string
  createdAt: number
  stateful: boolean
  size: number | null
}

export interface Domain {
  id: string
  domain: string
  targetPort: number
  status: string
  error: string | null
}
