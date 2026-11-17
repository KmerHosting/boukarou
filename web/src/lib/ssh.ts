import type { Instance } from './types'

export const sshLine = (i: Instance) => (i.sshPort ? `ssh root@${i.sshHost || location.hostname} -p ${i.sshPort}` : '')
