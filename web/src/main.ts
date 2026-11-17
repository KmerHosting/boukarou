import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'
import './style.css'

createApp(App).use(router).mount('#app')
