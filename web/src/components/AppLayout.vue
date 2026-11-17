<script setup lang="ts">
import {
  ActivityIcon, BoxesIcon, ContainerIcon, GaugeIcon, LanguagesIcon, LogOutIcon, MoonIcon, PlusIcon, SettingsIcon,
  ShieldCheckIcon, SunIcon, UserCogIcon, UsersIcon,
} from '@lucide/vue'
import { useColorMode } from '@vueuse/core'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandLogo from '@/components/app/BrandLogo.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import { user, version } from '@/composables/useSession'
import { post } from '@/lib/api'
import { lang, setLang, t } from '@/lib/i18n'

const route = useRoute()
const router = useRouter()
const mode = useColorMode({ storageKey: 'boukarou-theme' })

const isAdmin = computed(() => user.value?.role === 'admin')

const app = computed(() => [
  { to: '/', label: t('My containers'), icon: ContainerIcon, active: route.path === '/' || route.path.startsWith('/c/') },
  { to: '/new', label: t('New container'), icon: PlusIcon, active: route.path === '/new' },
])
const adminLinks = computed(() => [
  { to: '/admin', label: t('Overview'), icon: GaugeIcon, active: route.path === '/admin' },
  { to: '/admin/users', label: t('Users'), icon: UsersIcon, active: route.path.startsWith('/admin/users') },
  { to: '/admin/containers', label: t('Containers'), icon: BoxesIcon, active: route.path === '/admin/containers' },
  { to: '/admin/activity', label: t('Activity'), icon: ActivityIcon, active: route.path === '/admin/activity' },
  { to: '/admin/settings', label: t('Settings'), icon: SettingsIcon, active: route.path === '/admin/settings' },
])

const title = computed(() => (typeof route.meta.title === 'string' ? t(route.meta.title) : ''))

async function signOut() {
  await post('/api/auth/logout').catch(() => null)
  user.value = null
  await router.push('/login')
}
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" as-child>
              <RouterLink to="/">
                <BrandLogo :size="32" />
                <div class="grid flex-1 text-left leading-tight">
                  <span class="truncate font-semibold">Boukarou</span>
                  <span class="text-muted-foreground truncate text-xs">{{ t('Container panel') }}</span>
                </div>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{{ t('Containers') }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="link in app" :key="link.to">
                <SidebarMenuButton as-child :is-active="link.active" :tooltip="link.label">
                  <RouterLink :to="link.to"><component :is="link.icon" /><span>{{ link.label }}</span></RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup v-if="isAdmin">
          <SidebarGroupLabel>{{ t('Admin console') }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="link in adminLinks" :key="link.to">
                <SidebarMenuButton as-child :is-active="link.active" :tooltip="link.label">
                  <RouterLink :to="link.to"><component :is="link.icon" /><span>{{ link.label }}</span></RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <SidebarMenuButton size="lg" :tooltip="user?.username">
                  <div class="bg-muted flex size-8 items-center justify-center rounded-lg font-mono text-sm font-semibold uppercase">
                    {{ user?.username.slice(0, 2) }}
                  </div>
                  <div class="grid flex-1 text-left leading-tight">
                    <span class="truncate font-mono text-sm font-medium">{{ user?.username }}</span>
                    <span class="text-muted-foreground truncate text-xs">{{ isAdmin ? t('Administrator') : t('User') }}</span>
                  </div>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" class="w-56">
                <DropdownMenuLabel class="text-muted-foreground text-xs font-normal">Boukarou {{ version }}</DropdownMenuLabel>
                <DropdownMenuItem as-child>
                  <RouterLink to="/account"><ShieldCheckIcon /> {{ t('Account & security') }}</RouterLink>
                </DropdownMenuItem>
                <DropdownMenuItem @select="setLang(lang === 'fr' ? 'en' : 'fr')">
                  <LanguagesIcon /> {{ lang === 'fr' ? 'English' : 'Français' }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="signOut"><LogOutIcon /> {{ t('Sign out') }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset>
      <header class="bg-background/95 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
        <SidebarTrigger class="-ml-1" />
        <Separator orientation="vertical" class="mr-2 h-4! self-center!" />
        <h1 class="min-w-0 truncate text-sm font-medium">{{ title }}</h1>
        <div class="ml-auto flex items-center gap-1">
          <Button v-if="isAdmin && !route.path.startsWith('/admin')" variant="ghost" size="sm" as-child>
            <RouterLink to="/admin"><UserCogIcon data-icon="inline-start" /> {{ t('Admin console') }}</RouterLink>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            :aria-label="mode === 'dark' ? t('Light') : t('Dark')"
            @click="mode = mode === 'dark' ? 'light' : 'dark'"
          >
            <SunIcon v-if="mode === 'dark'" />
            <MoonIcon v-else />
          </Button>
        </div>
      </header>
      <main class="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-5 p-4 md:p-6">
        <RouterView />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
