import { createRouter, createWebHistory } from 'vue-router'
import { ready, refreshSession, user } from '@/composables/useSession'
import { onAuthError } from '@/lib/api'
import { t } from '@/lib/i18n'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/pages/Login.vue'), meta: { open: true, title: 'Sign in' } },
    { path: '/password', name: 'password', component: () => import('@/pages/ForcePassword.vue'), meta: { title: 'Choose a password' } },
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        { path: '', name: 'containers', component: () => import('@/pages/Containers.vue'), meta: { title: 'My containers' } },
        { path: 'new', name: 'new', component: () => import('@/pages/NewContainer.vue'), meta: { title: 'New container' } },
        { path: 'c/:id/:tab?', name: 'container', component: () => import('@/pages/Container.vue'), meta: { title: 'Container' } },
        { path: 'account', name: 'account', component: () => import('@/pages/Account.vue'), meta: { title: 'Account & security' } },
        { path: 'admin', name: 'admin', component: () => import('@/pages/admin/Overview.vue'), meta: { admin: true, title: 'Overview' } },
        { path: 'admin/users', name: 'admin-users', component: () => import('@/pages/admin/Users.vue'), meta: { admin: true, title: 'Users' } },
        { path: 'admin/users/:uid', name: 'admin-user', component: () => import('@/pages/admin/UserDetail.vue'), meta: { admin: true, title: 'User' } },
        { path: 'admin/containers', name: 'admin-containers', component: () => import('@/pages/admin/Containers.vue'), meta: { admin: true, title: 'Containers' } },
        { path: 'admin/activity', name: 'admin-activity', component: () => import('@/pages/admin/Activity.vue'), meta: { admin: true, title: 'Activity' } },
        { path: 'admin/settings', name: 'admin-settings', component: () => import('@/pages/admin/Settings.vue'), meta: { admin: true, title: 'Settings' } },
      ],
    },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (!ready.value) await refreshSession()
  const u = user.value
  if (to.meta.open) return u ? { path: '/' } : true
  if (!u) return { path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } }
  if (u.mustChangePassword) return to.name === 'password' ? true : { name: 'password' }
  if (to.name === 'password') return { path: '/' }
  if (to.meta.admin && u.role !== 'admin') return { path: '/' }
  return true
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? t(to.meta.title) : ''
  document.title = title ? `${title} · Boukarou` : 'Boukarou'
})

// An expired session, or a password the administrator just reset, sends people back to the right page.
onAuthError(async (error) => {
  if (error.status === 401) {
    user.value = null
    if (!router.currentRoute.value.meta.open) await router.push({ path: '/login', query: { next: router.currentRoute.value.fullPath } })
  } else if (error.code === 'must_change_password') {
    await refreshSession()
    await router.push({ name: 'password' })
  }
})
