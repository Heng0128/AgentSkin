// SPDX-License-Identifier: MPL-2.0

/**
 * # create-builtin-themes.mjs — batch-author new built-in themes (ROADMAP P0-1)
 *
 * Expands the built-in catalog from 3 → 15 themes. Each theme is defined as a
 * hand-designed 14-token palette below; border/button/focusRing are derived
 * from the accent color for consistent contrast behaviour. Every theme ships
 * two alternative color schemes (color-schemes/<id>.json).
 *
 * Reuses the shipped targets/verification block from nordic-minimal so all
 * six agents keep the same injection anchors. After running this script, run
 * the existing pipeline:
 *
 *   node scripts/build-palette.mjs all
 *   node scripts/generate-theme-css.mjs
 *   node scripts/generate-theme-assets.mjs
 *   npm run check:themes
 *
 * Idempotent: re-running overwrites the generated manifests/schemes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');

// ---------------------------------------------------------------------------
// Derived tokens — keep border/button/focus behaviour consistent across all
// hand-authored palettes.
// ---------------------------------------------------------------------------

function rgbTriple(hex) {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

/** Dark themes: accent-tinted translucent strokes; light themes: dark strokes. */
function deriveTokens(c, mode) {
  const dark = mode === 'dark';
  return {
    ...c,
    border: dark ? `rgba(${rgbTriple(c.accent)}, 0.18)` : 'rgba(40, 42, 54, 0.14)',
    buttonBackground: dark
      ? `rgba(${rgbTriple(c.accent)}, 0.14)`
      : `rgba(${rgbTriple(c.accent)}, 0.16)`,
    buttonForeground: c.accent,
    focusRing: dark ? `${c.accent}60` : `rgba(${rgbTriple(c.accent)}, 0.4)`,
  };
}

// ---------------------------------------------------------------------------
// Theme definitions — 12 new themes (id must be lowercase, kebab-case).
// `c` holds the 10 core hand-picked colors; derived tokens are computed.
// ---------------------------------------------------------------------------

const AUTHOR = { name: 'AgentSkin Team', url: 'https://github.com/Heng0128/AgentSkin' };

const THEMES = [
  {
    id: 'forest-pine',
    name: 'Forest Pine',
    displayName: '松林雾霭',
    category: 'dark',
    description: '深松针绿与苔藓灰的低语，像清晨雾气里的针叶林。沉静护眼，适合深夜长编码。',
    tags: ['dark', 'green', 'nature'],
    mode: 'dark',
    c: {
      accent: '#8fbf9f',
      secondary: '#a3b8a0',
      background: '#0d1512',
      foreground: '#d5e2d8',
      muted: '#7d8f82',
      surface: '#14201b',
      surfaceElevated: '#1b2a23',
      codeBackground: '#080f0c',
      codeForeground: '#c2d4c6',
      inputBackground: '#16241e',
    },
    schemes: [
      {
        id: 'moss',
        name: 'Moss',
        description: '苔原暖绿：把松林染上一层初春的苔色。',
        colors: {
          accent: '#a8bf7f',
          secondary: '#c0bf9a',
          background: '#12180e',
          foreground: '#e2e8d5',
          muted: '#8d947c',
          surface: '#1a2214',
          surfaceElevated: '#222d1a',
          codeBackground: '#0b100a',
          codeForeground: '#d2dcc0',
          inputBackground: '#1e2916',
        },
      },
      {
        id: 'birch',
        name: 'Birch',
        description: '白桦暖光：松林尽头的暖色暮光。',
        colors: {
          accent: '#d8b48f',
          secondary: '#c9b39c',
          background: '#161210',
          foreground: '#e8ddd2',
          muted: '#94897d',
          surface: '#1e1815',
          surfaceElevated: '#27201b',
          codeBackground: '#0f0c0a',
          codeForeground: '#dbd0c2',
          inputBackground: '#221c17',
        },
      },
    ],
  },
  {
    id: 'midnight-jazz',
    name: 'Midnight Jazz',
    displayName: '午夜爵士',
    category: 'dark',
    description: '深蓝夜幕下的一盏琥珀铜管。慵懒、温暖、带着俱乐部的微醺光晕。',
    tags: ['dark', 'amber', 'warm'],
    mode: 'dark',
    c: {
      accent: '#d9a26b',
      secondary: '#b09078',
      background: '#0e1016',
      foreground: '#e4e0d8',
      muted: '#8b877f',
      surface: '#151823',
      surfaceElevated: '#1c202e',
      codeBackground: '#090b10',
      codeForeground: '#d0ccc2',
      inputBackground: '#181c29',
    },
    schemes: [
      {
        id: 'sax',
        name: 'Sax',
        description: '萨克斯蓝调：夜色更深，铜管更亮。',
        colors: {
          accent: '#7f9fd9',
          secondary: '#96a3c0',
          background: '#0a0e18',
          foreground: '#dbe1ef',
          muted: '#757f99',
          surface: '#111726',
          surfaceElevated: '#181f33',
          codeBackground: '#070a12',
          codeForeground: '#c4cde2',
          inputBackground: '#141b2c',
        },
      },
      {
        id: 'smoke',
        name: 'Smoke',
        description: '烟雾紫：爵士散场后的紫色余烬。',
        colors: {
          accent: '#b48fd9',
          secondary: '#a894b8',
          background: '#131018',
          foreground: '#e4dee9',
          muted: '#8d8496',
          surface: '#1a1622',
          surfaceElevated: '#221c2d',
          codeBackground: '#0d0b12',
          codeForeground: '#d4cddd',
          inputBackground: '#1e1927',
        },
      },
    ],
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    displayName: '蔷薇石英',
    category: 'light',
    description: '晨雾玫瑰色的亮面主题，柔和不刺眼。为白昼里的温柔专注而设。',
    tags: ['light', 'pink', 'soft'],
    mode: 'light',
    c: {
      accent: '#c4708f',
      secondary: '#b08296',
      background: '#f8f3f4',
      foreground: '#3a2a30',
      muted: '#8a7078',
      surface: '#ffffff',
      surfaceElevated: '#fdf9fa',
      codeBackground: '#f0e8ea',
      codeForeground: '#4a3a40',
      inputBackground: '#f5eef0',
    },
    schemes: [
      {
        id: 'lavender',
        name: 'Lavender',
        description: '薰衣草田：玫瑰退场，淡紫接管。',
        colors: {
          accent: '#8a70c4',
          secondary: '#9d88b8',
          background: '#f5f3f8',
          foreground: '#2e2a3a',
          muted: '#7a7090',
          surface: '#ffffff',
          surfaceElevated: '#faf9fd',
          codeBackground: '#ece8f2',
          codeForeground: '#3e3a4a',
          inputBackground: '#f2eef7',
        },
      },
      {
        id: 'sage',
        name: 'Sage',
        description: '鼠尾草绿：一点清醒的绿意平衡甜度。',
        colors: {
          accent: '#70a88f',
          secondary: '#8aab96',
          background: '#f3f6f4',
          foreground: '#2a3a32',
          muted: '#70887c',
          surface: '#ffffff',
          surfaceElevated: '#f9fcfa',
          codeBackground: '#e8f0ec',
          codeForeground: '#3a4a42',
          inputBackground: '#eff5f1',
        },
      },
    ],
  },
  {
    id: 'ocean-tide',
    name: 'Ocean Tide',
    displayName: '深海潮汐',
    category: 'dark',
    description: '马里亚纳式的深蓝与荧光青。像夜潜时头灯扫过珊瑚礁的那一瞬。',
    tags: ['dark', 'blue', 'cyan'],
    mode: 'dark',
    c: {
      accent: '#6fc3d9',
      secondary: '#8fa8bf',
      background: '#0a1218',
      foreground: '#d8e4ea',
      muted: '#7a8b94',
      surface: '#101c26',
      surfaceElevated: '#172531',
      codeBackground: '#060c10',
      codeForeground: '#c0d2da',
      inputBackground: '#132028',
    },
    schemes: [
      {
        id: 'coral',
        name: 'Coral',
        description: '珊瑚暖流：寒流里涌入的一股暖水。',
        colors: {
          accent: '#d98f6f',
          secondary: '#bf9c8f',
          background: '#141012',
          foreground: '#e8ded8',
          muted: '#94877f',
          surface: '#1e181a',
          surfaceElevated: '#272022',
          codeBackground: '#0e0b0c',
          codeForeground: '#dbd0c8',
          inputBackground: '#221c1e',
        },
      },
      {
        id: 'abyss',
        name: 'Abyss',
        description: '深渊紫：再往下潜一千米的紫色海沟。',
        colors: {
          accent: '#8f7fd9',
          secondary: '#9a90b8',
          background: '#0d0a16',
          foreground: '#e0dcea',
          muted: '#847f96',
          surface: '#151224',
          surfaceElevated: '#1c182e',
          codeBackground: '#090710',
          codeForeground: '#cec9dd',
          inputBackground: '#181429',
        },
      },
    ],
  },
  {
    id: 'amber-dusk',
    name: 'Amber Dusk',
    displayName: '琥珀暮色',
    category: 'dark',
    description: '日落时分被烤暖的深棕与琥珀金。壁炉、旧木桌和一杯波本的颜色。',
    tags: ['dark', 'amber', 'cozy'],
    mode: 'dark',
    c: {
      accent: '#d9a26b',
      secondary: '#bfa07f',
      background: '#161210',
      foreground: '#e8ddd0',
      muted: '#96887a',
      surface: '#201a16',
      surfaceElevated: '#29211b',
      codeBackground: '#0f0c0a',
      codeForeground: '#d8cbb8',
      inputBackground: '#241d18',
    },
    schemes: [
      {
        id: 'ember',
        name: 'Ember',
        description: '炉火橙：暮色里烧得最旺的那块炭。',
        colors: {
          accent: '#d97f4f',
          secondary: '#bf8f6f',
          background: '#171110',
          foreground: '#e9ded6',
          muted: '#968579',
          surface: '#211917',
          surfaceElevated: '#2b211d',
          codeBackground: '#100c0b',
          codeForeground: '#d9ccc0',
          inputBackground: '#261e1b',
        },
      },
      {
        id: 'dune',
        name: 'Dune',
        description: '沙丘金：风把暮色吹成了沙的颜色。',
        colors: {
          accent: '#c9b46f',
          secondary: '#b8a87f',
          background: '#161408',
          foreground: '#e8e2d0',
          muted: '#96907a',
          surface: '#201d10',
          surfaceElevated: '#292515',
          codeBackground: '#0f0e06',
          codeForeground: '#d8d2b8',
          inputBackground: '#242112',
        },
      },
    ],
  },
  {
    id: 'graphite-code',
    name: 'Graphite Code',
    displayName: '石墨工坊',
    category: 'light',
    description: '纸面石墨色的亮面工作主题，克制的蓝灰笔触。打印纸与铅笔屑的气息。',
    tags: ['light', 'gray', 'focus'],
    mode: 'light',
    c: {
      accent: '#5b7a99',
      secondary: '#7a8a96',
      background: '#f4f5f6',
      foreground: '#26292e',
      muted: '#71767d',
      surface: '#ffffff',
      surfaceElevated: '#fafbfc',
      codeBackground: '#eaecef',
      codeForeground: '#363a40',
      inputBackground: '#f0f2f4',
    },
    schemes: [
      {
        id: 'blueprint',
        name: 'Blueprint',
        description: '蓝图青：工程师图纸上的那种蓝。',
        colors: {
          accent: '#4f6fd9',
          secondary: '#7086c0',
          background: '#f4f6f9',
          foreground: '#262c38',
          muted: '#707a8c',
          surface: '#ffffff',
          surfaceElevated: '#fafbfd',
          codeBackground: '#e9edf4',
          codeForeground: '#343c4a',
          inputBackground: '#eff2f6',
        },
      },
      {
        id: 'sepia',
        name: 'Sepia',
        description: '复古棕褐：泛黄图纸与旧墨水的色调。',
        colors: {
          accent: '#997a5b',
          secondary: '#96877a',
          background: '#f6f4f1',
          foreground: '#2e2a24',
          muted: '#7d766d',
          surface: '#ffffff',
          surfaceElevated: '#fbfaf8',
          codeBackground: '#efecE7',
          codeForeground: '#3e3a32',
          inputBackground: '#f2efe9',
        },
      },
    ],
  },
  {
    id: 'aurora-violet',
    name: 'Aurora Violet',
    displayName: '极光紫',
    category: 'dark',
    description: '北纬 68 度的紫色极光落进深夜的蓝黑色冰原。流动、清冽、有距离感。',
    tags: ['dark', 'violet', 'vivid'],
    mode: 'dark',
    c: {
      accent: '#a98fe8',
      secondary: '#94a0d9',
      background: '#0e0a18',
      foreground: '#e2def0',
      muted: '#847f9c',
      surface: '#161226',
      surfaceElevated: '#1e1831',
      codeBackground: '#090710',
      codeForeground: '#cfcadd',
      inputBackground: '#191429',
    },
    schemes: [
      {
        id: 'ice',
        name: 'Ice',
        description: '冰蓝极光：紫色退场，青蓝色接管夜空。',
        colors: {
          accent: '#8fd4e8',
          secondary: '#94b0c9',
          background: '#0a1016',
          foreground: '#dce8ee',
          muted: '#7a8b94',
          surface: '#101a24',
          surfaceElevated: '#17232e',
          codeBackground: '#060b0f',
          codeForeground: '#c8d8de',
          inputBackground: '#131e28',
        },
      },
      {
        id: 'ember',
        name: 'Ember',
        description: '余烬粉：极光散去后的暖粉色地平线。',
        colors: {
          accent: '#e88fb0',
          secondary: '#c994a8',
          background: '#160a12',
          foreground: '#f0dee6',
          muted: '#9c7f8e',
          surface: '#261220',
          surfaceElevated: '#31182a',
          codeBackground: '#10070d',
          codeForeground: '#ddcad4',
          inputBackground: '#291423',
        },
      },
    ],
  },
  {
    id: 'sakura-noir',
    name: 'Sakura Noir',
    displayName: '夜樱',
    category: 'dark',
    description: '夜里亮灯的樱花树——深色夜幕上落着一层绯粉。与樱花粉彩互为昼夜。',
    tags: ['dark', 'pink', 'elegant'],
    mode: 'dark',
    c: {
      accent: '#e8a0b8',
      secondary: '#c9a0b0',
      background: '#141014',
      foreground: '#eadfe4',
      muted: '#96868e',
      surface: '#1e181e',
      surfaceElevated: '#272026',
      codeBackground: '#0e0b0e',
      codeForeground: '#d8ccd2',
      inputBackground: '#221b22',
    },
    schemes: [
      {
        id: 'wisteria',
        name: 'Wisteria',
        description: '紫藤夜：樱谢之后，紫藤垂进夜色。',
        colors: {
          accent: '#b0a0e8',
          secondary: '#a89cc0',
          background: '#121018',
          foreground: '#e6e0f0',
          muted: '#8c84a0',
          surface: '#1b1824',
          surfaceElevated: '#23202e',
          codeBackground: '#0d0b12',
          codeForeground: '#d6d0e2',
          inputBackground: '#1f1c28',
        },
      },
      {
        id: 'ume',
        name: 'Ume',
        description: '红梅雪：雪夜里的红梅，比樱更早开。',
        colors: {
          accent: '#d97f8f',
          secondary: '#c08f96',
          background: '#161012',
          foreground: '#ecdfe0',
          muted: '#9c8489',
          surface: '#211819',
          surfaceElevated: '#2a2022',
          codeBackground: '#0f0b0c',
          codeForeground: '#daccce',
          inputBackground: '#251c1e',
        },
      },
    ],
  },
  {
    id: 'bamboo-mist',
    name: 'Bamboo Mist',
    displayName: '竹雾茶烟',
    category: 'light',
    description: '宣纸底色上的竹青与茶褐。像雨天隔窗看竹影，安静、透气、不催促。',
    tags: ['light', 'green', 'zen'],
    mode: 'light',
    c: {
      accent: '#6f9480',
      secondary: '#8a9a84',
      background: '#f5f4ef',
      foreground: '#2c302a',
      muted: '#767c70',
      surface: '#ffffff',
      surfaceElevated: '#fbfaf7',
      codeBackground: '#ecEde8',
      codeForeground: '#3c403a',
      inputBackground: '#f1f2ec',
    },
    schemes: [
      {
        id: 'matcha',
        name: 'Matcha',
        description: '抹茶乳：把竹色调进一杯抹茶拿铁。',
        colors: {
          accent: '#7fa860',
          secondary: '#94a884',
          background: '#f4f6ef',
          foreground: '#2c3226',
          muted: '#747e68',
          surface: '#ffffff',
          surfaceElevated: '#fafbf7',
          codeBackground: '#e9eee2',
          codeForeground: '#3a4232',
          inputBackground: '#eff3e8',
        },
      },
      {
        id: 'jade',
        name: 'Jade',
        description: '青玉沉水：更深一点的玉色，压住纸面的暖。',
        colors: {
          accent: '#5b8a8f',
          secondary: '#7a9694',
          background: '#f2f5f5',
          foreground: '#26302e',
          muted: '#6e7c7a',
          surface: '#ffffff',
          surfaceElevated: '#f8fbfb',
          codeBackground: '#e6eeee',
          codeForeground: '#34403e',
          inputBackground: '#edf2f2',
        },
      },
    ],
  },
  {
    id: 'terminal-green',
    name: 'Terminal Green',
    displayName: '终端磷光',
    category: 'dark',
    description: '老式 CRT 的磷光绿，黑得纯粹的底。给怀念命令行年代的人。',
    tags: ['dark', 'retro', 'green'],
    mode: 'dark',
    c: {
      accent: '#6fd97f',
      secondary: '#8fbf94',
      background: '#0a0e0a',
      foreground: '#d5e8d5',
      muted: '#77887a',
      surface: '#101810',
      surfaceElevated: '#172017',
      codeBackground: '#060a06',
      codeForeground: '#c0d8c0',
      inputBackground: '#131c13',
    },
    schemes: [
      {
        id: 'cyan',
        name: 'Cyan',
        description: 'IBM 青：磷光绿换成了 3270 终端的青色。',
        colors: {
          accent: '#6fd4d9',
          secondary: '#8fb4b8',
          background: '#0a1010',
          foreground: '#d5e6e8',
          muted: '#778a8c',
          surface: '#101818',
          surfaceElevated: '#172121',
          codeBackground: '#060b0b',
          codeForeground: '#c0d6d8',
          inputBackground: '#131d1d',
        },
      },
      {
        id: 'amber',
        name: 'Amber',
        description: '琥珀单色：DEC 终端的经典琥珀屏。',
        colors: {
          accent: '#d9a86f',
          secondary: '#bf9f7f',
          background: '#0f0c08',
          foreground: '#e8ded0',
          muted: '#96887a',
          surface: '#181410',
          surfaceElevated: '#201b15',
          codeBackground: '#0a0806',
          codeForeground: '#d8ccbc',
          inputBackground: '#1c1712',
        },
      },
    ],
  },
  {
    id: 'glacier-white',
    name: 'Glacier White',
    displayName: '冰川白',
    category: 'minimal',
    description: '几乎无色的白与冰蓝点缀。给想要"什么都没发生"的界面的极简主义者。',
    tags: ['light', 'minimal', 'clean'],
    mode: 'light',
    c: {
      accent: '#5b8fbf',
      secondary: '#8a9aa6',
      background: '#fafbfc',
      foreground: '#24282c',
      muted: '#74787c',
      surface: '#ffffff',
      surfaceElevated: '#f6f8fa',
      codeBackground: '#eff1f3',
      codeForeground: '#34383c',
      inputBackground: '#f2f4f6',
    },
    schemes: [
      {
        id: 'mint',
        name: 'Mint',
        description: '冰面薄荷：白里透出的第一缕凉绿。',
        colors: {
          accent: '#5bbf8f',
          secondary: '#8aa69c',
          background: '#f9fcfa',
          foreground: '#242c28',
          muted: '#727c78',
          surface: '#ffffff',
          surfaceElevated: '#f5faf7',
          codeBackground: '#eef3f0',
          codeForeground: '#343c38',
          inputBackground: '#f1f5f3',
        },
      },
      {
        id: 'frost',
        name: 'Frost',
        description: '霜色紫灰：白昼将尽时冰面上的冷紫。',
        colors: {
          accent: '#7f8fc9',
          secondary: '#96a0b8',
          background: '#faf9fc',
          foreground: '#26282e',
          muted: '#767a84',
          surface: '#ffffff',
          surfaceElevated: '#f7f6fa',
          codeBackground: '#efeff3',
          codeForeground: '#36383e',
          inputBackground: '#f2f2f6',
        },
      },
    ],
  },
  {
    id: 'cyber-rose',
    name: 'Cyber Rose',
    displayName: '赛博蔷薇',
    category: 'dark',
    description: '霓虹雨夜里的玫瑰色光管。一点合成器浪潮的甜，一点夜城的酷。',
    tags: ['dark', 'neon', 'pink'],
    mode: 'dark',
    c: {
      accent: '#e87fa8',
      secondary: '#b88fc0',
      background: '#120e14',
      foreground: '#e8dee4',
      muted: '#927f8c',
      surface: '#1b1520',
      surfaceElevated: '#241c2a',
      codeBackground: '#0d0a10',
      codeForeground: '#d6cad2',
      inputBackground: '#1f1824',
    },
    schemes: [
      {
        id: 'violet',
        name: 'Violet',
        description: '霓虹紫：玫瑰色的隔壁，是更冷的紫灯。',
        colors: {
          accent: '#a87fe8',
          secondary: '#9c8fc9',
          background: '#100e18',
          foreground: '#e4deef',
          muted: '#8a7f9c',
          surface: '#181526',
          surfaceElevated: '#201c30',
          codeBackground: '#0b0910',
          codeForeground: '#d2cade',
          inputBackground: '#1c1828',
        },
      },
      {
        id: 'cyan',
        name: 'Cyan',
        description: '霓虹青：雨停之后，青色霓虹亮起来。',
        colors: {
          accent: '#6fd4d9',
          secondary: '#8fb0c0',
          background: '#0e1216',
          foreground: '#dde8ea',
          muted: '#7f9094',
          surface: '#151c22',
          surfaceElevated: '#1c252c',
          codeBackground: '#0a0e11',
          codeForeground: '#cad8da',
          inputBackground: '#182026',
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const referenceManifest = JSON.parse(
  await readFile(path.join(THEMES_DIR, 'nordic-minimal', 'manifest.json'), 'utf8'),
);
const TARGETS = referenceManifest.targets;

let created = 0;
for (const theme of THEMES) {
  const dir = path.join(THEMES_DIR, theme.id);
  await mkdir(path.join(dir, 'color-schemes'), { recursive: true });

  const manifest = {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    id: theme.id,
    name: theme.name,
    displayName: theme.displayName,
    version: '1.0.0',
    description: theme.description,
    author: AUTHOR,
    mode: theme.mode,
    category: theme.category,
    tags: theme.tags,
    icon: 'icon.png',
    preview: 'preview.png',
    hero: 'hero.webp',
    targets: TARGETS,
    colors: deriveTokens(theme.c, theme.mode),
    colorSchemes: theme.schemes.map((s) => s.id),
  };
  await writeFile(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  for (const scheme of theme.schemes) {
    const schemeJson = {
      id: scheme.id,
      name: scheme.name,
      mode: theme.mode,
      description: scheme.description,
      colors: deriveTokens(scheme.colors, theme.mode),
    };
    await writeFile(
      path.join(dir, 'color-schemes', `${scheme.id}.json`),
      `${JSON.stringify(schemeJson, null, 2)}\n`,
      'utf8',
    );
  }
  created += 1;
  console.log(`[create-themes] ${theme.id}: manifest + ${theme.schemes.length} color schemes`);
}

console.log(`\nDone: ${created} themes created (total built-in now ${created + 3}).`);
console.log(
  'Next: build-palette.mjs all → generate-theme-css.mjs → generate-theme-assets.mjs → check:themes',
);
