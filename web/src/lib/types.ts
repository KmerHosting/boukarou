export type Limits = {
  max_instances: number | null;
  max_cpu: number | null;
  max_memory_mb: number | null;
  max_disk_gb: number | null;
  max_snapshots: number | null;
  traffic_gb: number | null;
  max_domains: number | null;
};

export type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  limits: Limits;
  note: string;
  createdAt: number;
  lastLoginAt: number | null;
};

export type AdminUser = User & { usage: { instances: number; cpu: number; memoryMb: number; diskGb: number; domains: number } };

export type Image = { id: string; family: string; name: string; version: string; alias?: string };

export type Status = "creating" | "running" | "stopped" | "frozen" | "failed" | "reinstalling" | "deleting" | "unknown";

export type Instance = {
  id: string;
  name: string;
  userId: number;
  image: Image;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  status: Status;
  progress: string | null;
  error: string | null;
  busy: string | null;
  sshPort: number | null;
  sshHost: string | null;
  ipv4: string | null;
  ipv6: string | null;
  hasSshKey: boolean;
  trafficBlocked: boolean;
  passwordPending: boolean;
  createdAt: number;
  owner?: { id: number; username: string };
};

export type EventItem = {
  id: number;
  at: number;
  level: string;
  action: string;
  message: string | null;
  actor: string | null;
  user: string | null;
  instanceId: string | null;
};

export type Usage = { instances: number; cpu: number; memoryMb: number; diskGb: number };
