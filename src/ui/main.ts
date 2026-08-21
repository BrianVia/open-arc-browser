import { mount } from 'svelte'
import App from './App.svelte'
import CommandBar from './CommandBar.svelte'
import './foundation/theme.css'

const component = new URLSearchParams(window.location.search).get('surface') === 'commandbar' ? CommandBar : App
mount(component, { target: document.getElementById('app')! })
