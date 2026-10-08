import * as Vue from 'vue'
import * as ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { parse, compileTemplate, compileScript } from '@vue/compiler-sfc'
import { transform } from 'sucrase'

export interface CompileResult {
  component?: any
  error?: string
  removeStyle?: () => void
}

export function compileVueSfc(sfcSource: string): CompileResult {
  const scopeId = 'data-v-' + Math.random().toString(36).substring(2, 9)

  try {
    const { descriptor, errors } = parse(sfcSource)
    if (errors && errors.length > 0) {
      return { error: errors.map((e) => e.message || String(e)).join('\n') }
    }

    let scriptCompiled = ''
    if (descriptor.script || descriptor.scriptSetup) {
      const scriptResult = compileScript(descriptor, {
        id: scopeId,
        inlineTemplate: true
      })
      scriptCompiled = scriptResult.content
    }

    let templateCompiled = ''
    if (descriptor.template && !scriptCompiled) {
      const templateResult = compileTemplate({
        source: descriptor.template.content,
        filename: 'dynamic.vue',
        id: scopeId,
        scoped: descriptor.styles.some((s) => s.scoped)
      })
      if (templateResult.errors && templateResult.errors.length > 0) {
        return { error: templateResult.errors.join('\n') }
      }
      templateCompiled = templateResult.code
    }

    let stylesCss = ''
    for (const style of descriptor.styles) {
      stylesCss += style.content + '\n'
    }

    let styleEl: HTMLStyleElement | null = null
    if (stylesCss) {
      styleEl = document.createElement('style')
      styleEl.innerHTML = stylesCss
      document.head.appendChild(styleEl)
    }

    const removeStyle = () => {
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl)
      }
    }

    const rawCode = scriptCompiled || templateCompiled || 'export default {}'

    // Use sucrase to transform TS + ES modules to CommonJS
    const transformed = transform(rawCode, {
      transforms: ['typescript', 'imports']
    }).code

    const exports: any = {}
    const module = { exports }

    // Prepare evaluation context
    const runCode = new Function(
      'exports',
      'module',
      'require',
      'Vue',
      'ElementPlus',
      transformed
    )

    const customRequire = (name: string) => {
      if (name === 'vue') return Vue
      if (name === 'element-plus') return ElementPlus
      if (name === '@element-plus/icons-vue') return ElementPlusIconsVue
      throw new Error(`Module not supported in sandbox: ${name}`)
    }

    runCode(exports, module, customRequire, Vue, ElementPlus)

    const finalComponent = module.exports.default || module.exports

    return {
      component: finalComponent,
      removeStyle
    }
  } catch (err: any) {
    return {
      error: err.message || String(err)
    }
  }
}
