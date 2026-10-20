import { register } from 'node:module';
import { JSDOM } from 'jsdom';
register('./loader.mjs',import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','MutationObserver']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
