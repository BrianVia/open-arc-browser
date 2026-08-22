import { mount } from 'svelte'
import App from './App.svelte'
import '../foundation/theme.css'

mount(App, { target: document.getElementById('app')! })
