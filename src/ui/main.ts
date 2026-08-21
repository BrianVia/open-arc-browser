import { mount } from 'svelte'
import App from './App.svelte'
import CommandBar from './CommandBar.svelte'
import ExtensionsPage from './ExtensionsPage.svelte'
import './foundation/theme.css'

const surface = new URLSearchParams(window.location.search).get('surface')
const component = surface === 'commandbar' ? CommandBar : surface === 'extensions' ? ExtensionsPage : App
mount(component, { target: document.getElementById('app')! })
