import { mount } from 'svelte'
import CommandBar from './CommandBar.svelte'
import '../foundation/theme.css'

mount(CommandBar, { target: document.getElementById('app')! })
