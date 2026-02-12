const fs = require('fs');
const path = require('path');

const SVG_DIR = path.join(__dirname, '..', '..', 'svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'icons');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const RESERVED_NAMES = new Set([
  'Component', 'Fragment', 'Element', 'Node', 'Event', 'Error',
  'Function', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Symbol', 'Map', 'Set', 'Promise', 'Proxy', 'Reflect', 'Date',
  'RegExp', 'JSON', 'Math', 'Intl', 'NaN', 'Infinity', 'undefined',
  'null', 'true', 'false',
]);

function toPascalCase(filename) {
  const name = filename.replace(/^bx-/, '').replace(/\.svg$/, '');
  let result = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  if (/^\d/.test(result)) result = 'Icon' + result;
  if (RESERVED_NAMES.has(result)) result = result + 'Icon';
  return result;
}

function parseSvg(svgContent) {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';
  const innerMatch = svgContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  const innerContent = innerMatch ? innerMatch[1].trim() : '';
  return { viewBox, innerContent };
}

function escapeForTemplate(str) {
  return str.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function readPackSvgs(packName) {
  const packDir = path.join(SVG_DIR, packName);
  if (!fs.existsSync(packDir)) return new Map();
  const files = fs.readdirSync(packDir).filter(f => f.endsWith('.svg'));
  const svgs = new Map();
  for (const file of files) {
    const content = fs.readFileSync(path.join(packDir, file), 'utf8');
    const componentName = toPascalCase(file);
    svgs.set(componentName, { filename: file, content });
  }
  return svgs;
}

function generateComponent(componentName, packs, defaultPack) {
  const packSvgs = {};
  for (const pack of packs) {
    const packDir = path.join(SVG_DIR, pack);
    const files = fs.readdirSync(packDir).filter(f => f.endsWith('.svg'));
    for (const file of files) {
      if (toPascalCase(file) === componentName) {
        const content = fs.readFileSync(path.join(packDir, file), 'utf8');
        const { viewBox, innerContent } = parseSvg(content);
        packSvgs[pack] = { viewBox, innerContent: escapeForTemplate(innerContent) };
        break;
      }
    }
  }
  if (Object.keys(packSvgs).length === 0) return null;

  const pathsEntries = Object.entries(packSvgs)
    .map(([pack, { viewBox, innerContent }]) => `  ${pack}: { viewBox: '${viewBox}', content: \`${innerContent}\` }`)
    .join(',\n');

  return `import { defineComponent, h, computed } from 'vue';
import type { BoxIconProps } from '../types.js';
import { buildTransform, getSizePixels } from '../utils.js';

const paths: Record<string, { viewBox: string; content: string }> = {
${pathsEntries}
};

export const ${componentName} = defineComponent({
  name: '${componentName}',
  props: {
    pack: { type: String, default: '${defaultPack}' },
    fill: { type: String, default: 'currentColor' },
    opacity: { type: [Number, String], default: undefined },
    width: { type: [Number, String], default: undefined },
    height: { type: [Number, String], default: undefined },
    size: { type: String, default: 'base' },
    flip: { type: String, default: undefined },
    rotate: { type: [Number, String], default: undefined },
    removePadding: { type: Boolean, default: false },
  },
  setup(props, { attrs }) {
    const iconData = computed(() => paths[props.pack as string] || paths['${defaultPack}']);
    const transform = computed(() => buildTransform(props.flip as any, props.rotate));
    const resolvedWidth = computed(() => props.width ?? getSizePixels(props.size as any));
    const resolvedHeight = computed(() => props.height ?? getSizePixels(props.size as any));
    const resolvedViewBox = computed(() => props.removePadding ? '2 2 20 20' : iconData.value.viewBox);

    return () => h('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: resolvedViewBox.value,
      width: resolvedWidth.value,
      height: resolvedHeight.value,
      fill: props.fill,
      opacity: props.opacity,
      transform: transform.value,
      style: transform.value ? { transformOrigin: 'center' } : undefined,
      innerHTML: iconData.value.content,
      ...attrs,
    });
  },
});

export default ${componentName};
`;
}

function generate() {
  console.log('Generating Boxicons Vue components...\n');
  const basicSvgs = readPackSvgs('basic');
  const filledSvgs = readPackSvgs('filled');
  const brandsSvgs = readPackSvgs('brands');

  console.log('Found ' + basicSvgs.size + ' basic icons');
  console.log('Found ' + filledSvgs.size + ' filled icons');
  console.log('Found ' + brandsSvgs.size + ' brand icons');

  const iconConfigs = new Map();
  for (const name of basicSvgs.keys()) {
    const packs = ['basic'];
    if (filledSvgs.has(name)) packs.push('filled');
    iconConfigs.set(name, { packs, defaultPack: 'basic', isBrandOnly: false });
  }
  for (const name of filledSvgs.keys()) {
    if (!iconConfigs.has(name)) {
      iconConfigs.set(name, { packs: ['filled'], defaultPack: 'filled', isBrandOnly: false });
    }
  }
  for (const name of brandsSvgs.keys()) {
    if (!iconConfigs.has(name)) {
      iconConfigs.set(name, { packs: ['brands'], defaultPack: 'brands', isBrandOnly: true });
    } else {
      iconConfigs.get(name).packs.push('brands');
    }
  }

  console.log('\nGenerating ' + iconConfigs.size + ' unique icon components...\n');

  const exports = [];
  let generated = 0;
  for (const [name, config] of iconConfigs) {
    const component = generateComponent(name, config.packs, config.defaultPack);
    if (component) {
      fs.writeFileSync(path.join(OUTPUT_DIR, name + '.ts'), component);
      exports.push(name);
      generated++;
      if (generated % 100 === 0) console.log('   Generated ' + generated + ' components...');
    }
  }
  console.log('   Generated ' + generated + ' components total.\n');

  const iconsIndexContent = exports.sort().map(name => "export { " + name + " } from './" + name + ".js';").join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.ts'), iconsIndexContent + '\n');
  console.log('Generated icons/index.ts with all exports\n');
  console.log('Successfully generated ' + generated + ' icon components!');
}

generate();
