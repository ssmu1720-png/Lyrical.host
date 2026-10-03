import lyricalXmdImg from '../assets/images/bot_card_lyrical_xmd_1790943615962.jpg';
import arslanMdImg from '../assets/images/bot_card_arslan_md_1790943629970.jpg';
import wolfbotImg from '../assets/images/bot_card_wolfbot_1790943640357.jpg';
import toxicMdImg from '../assets/images/bot_card_toxic_md_1790943651976.jpg';
import ultraGuruImg from '../assets/images/bot_card_ultra_guru_1790943661872.jpg';
import keithMdImg from '../assets/images/bot_card_keith_md_1790944611163.jpg';
import blackPantherImg from '../assets/images/bot_card_black_panther_1790947338047.jpg';

export interface CatalogBotItem {
  id: string;
  rank: number;
  name: string;
  author: string;
  description: string;
  repoUrl: string;
  branch: string;
  startCommand: string;
  buildCommand: string;
  sessionEnvKey: string;
  sessionGeneratorUrl: string;
  image: string;
  deploymentsCount: number;
  featuredLabel?: string;
  category?: 'whatsapp_bot' | 'website' | 'web_service';
}

export const WEBSITE_CATALOG: CatalogBotItem[] = [
  {
    id: 'express-website',
    rank: 1,
    name: 'Full-Stack Node.js & Express Website',
    author: 'LYRICAL Web Services',
    description:
      'Deploy full-stack websites, REST APIs, or server-rendered web applications with high concurrency, dynamic routing, and automated port mapping.',
    repoUrl: 'https://github.com/expressjs/express',
    branch: 'master',
    startCommand: 'node server.js',
    buildCommand: 'npm install',
    sessionEnvKey: '',
    sessionGeneratorUrl: '',
    image: lyricalXmdImg,
    deploymentsCount: 3820,
    featuredLabel: 'POPULAR WEB',
    category: 'website',
  },
  {
    id: 'react-vite-website',
    rank: 2,
    name: 'React + Vite Modern Web App',
    author: 'Vite Ecosystem',
    description:
      'Lightning-fast modern frontend web application built with React, Vite, and Tailwind CSS. Built with `npm run build` and served live.',
    repoUrl: '',
    branch: 'main',
    startCommand: 'npx serve -s dist -l $PORT',
    buildCommand: 'npm install && npm run build',
    sessionEnvKey: '',
    sessionGeneratorUrl: '',
    image: blackPantherImg,
    deploymentsCount: 2940,
    featuredLabel: 'HIGH SPEED',
    category: 'website',
  },
  {
    id: 'static-html-website',
    rank: 3,
    name: 'Static HTML5 / CSS / JS Website',
    author: 'Web Standard',
    description:
      'Deploy portfolio websites, landing pages, documentation, or static HTML5 apps with instant live preview and reverse proxy.',
    repoUrl: '',
    branch: 'main',
    startCommand: 'npx serve -l $PORT .',
    buildCommand: '',
    sessionEnvKey: '',
    sessionGeneratorUrl: '',
    image: wolfbotImg,
    deploymentsCount: 1870,
    featuredLabel: 'EASY LAUNCH',
    category: 'website',
  },
  {
    id: 'python-flask-website',
    rank: 4,
    name: 'Python Flask / FastAPI Web App',
    author: 'Python Web',
    description:
      'Deploy modern Python web applications, microservices, or APIs with automated pip dependency installation and live web proxying.',
    repoUrl: '',
    branch: 'main',
    startCommand: 'python3 app.py',
    buildCommand: 'pip install -r requirements.txt',
    sessionEnvKey: '',
    sessionGeneratorUrl: '',
    image: toxicMdImg,
    deploymentsCount: 1420,
    featuredLabel: 'PYTHON WEB',
    category: 'website',
  },
];

export const BOT_CATALOG: CatalogBotItem[] = [
  {
    id: 'black-panther',
    rank: 1,
    name: 'BLACK PANTHER',
    author: 'Koyoteh',
    description:
      'BLACK-PANTHER Multi-Device WhatsApp Bot — High-speed automation, anti-delete protection, media tools, and instant session pairing.',
    repoUrl: 'https://github.com/koyoteh/BLACK-PANTHER',
    branch: 'main',
    startCommand: 'npm start',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: 'https://ultra-guru-pair-1.onrender.com/pair',
    image: blackPantherImg,
    deploymentsCount: 5480,
    featuredLabel: 'NEW RELEASE',
  },
  {
    id: 'keith-md',
    rank: 2,
    name: 'KEITH MD',
    author: 'Kkeizza (Keith)',
    description:
      'KEITH-MD Multi-Device WhatsApp Bot — Fast command execution, automated session pairing, media downloaders, and group management.',
    repoUrl: 'https://github.com/kkeizza/Keith',
    branch: 'main',
    startCommand: 'npm start',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION',
    sessionGeneratorUrl: 'https://keithsite.top/keithpair',
    image: keithMdImg,
    deploymentsCount: 5120,
    featuredLabel: 'FEATURED BOT',
  },
  {
    id: 'lyrical-xmd',
    rank: 3,
    name: 'LYRICAL XMD',
    author: 'LYRICAL Labs',
    description:
      'LYRICAL XMD WhatsApp Bot — Multi-device support, high-speed command execution, auto-status viewer, and group management.',
    repoUrl: 'https://github.com/lyrical57/Arslan_MD',
    branch: 'main',
    startCommand: 'node index.js',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: 'https://arslan-md-pair.onrender.com',
    image: lyricalXmdImg,
    deploymentsCount: 4685,
    featuredLabel: 'MOST DEPLOYED',
  },
  {
    id: 'arslan-md',
    rank: 4,
    name: 'ARSLAN-MD',
    author: 'Lyrical57',
    description:
      'Fast multi-device WhatsApp bot built with Node.js & Baileys featuring sticker creation, media downloaders, and anti-delete.',
    repoUrl: 'https://github.com/lyrical57/Arslan_MD',
    branch: 'main',
    startCommand: 'node index.js',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: 'https://arslan-md-pair.onrender.com',
    image: arslanMdImg,
    deploymentsCount: 615,
  },
  {
    id: 'wolfbot-md',
    rank: 5,
    name: 'WOLFBOT',
    author: 'Briton Kiplangat',
    description:
      'Professional WhatsApp Bot with auto-session authentication, group security guards, and instant media tools.',
    repoUrl: 'https://github.com/lyrical57/Arslan_MD',
    branch: 'main',
    startCommand: 'node index.js',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: 'https://arslan-md-pair.onrender.com',
    image: wolfbotImg,
    deploymentsCount: 237,
  },
  {
    id: 'toxic-md',
    rank: 6,
    name: 'Toxic-MD',
    author: 'Clinton Mwenda (xhclintohn)',
    description:
      'A lightning-fast WhatsApp bot with multi-device support, built on Node.js & WhiskeySockets Baileys.',
    repoUrl: 'https://github.com/xhclintohn/Toxic-MD',
    branch: 'main',
    startCommand: 'npm start',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION',
    sessionGeneratorUrl: 'https://toxicx.tech/pairing/',
    image: toxicMdImg,
    deploymentsCount: 99,
  },
  {
    id: 'ultra-guru',
    rank: 7,
    name: 'ULTRA GURU',
    author: 'Akida Rajab (GuruhTech)',
    description:
      'ULTRA GURU — A Powerful Multi-Device WhatsApp Bot built to enhance your WhatsApp automation experience.',
    repoUrl: 'https://github.com/GuruhTech/ULTRA-GURU',
    branch: 'main',
    startCommand: 'npm start',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: 'https://ultra-guru-pair-1.onrender.com/pair',
    image: ultraGuruImg,
    deploymentsCount: 72,
  },
  {
    id: 'custom-github-bot',
    rank: 8,
    name: 'Custom GitHub Bot',
    author: 'Your Repository',
    description:
      'Deploy any custom Node.js or Python WhatsApp bot directly from your own GitHub repository URL or Google Drive files.',
    repoUrl: '',
    branch: 'main',
    startCommand: 'node index.js',
    buildCommand: 'npm install',
    sessionEnvKey: 'SESSION_ID',
    sessionGeneratorUrl: '',
    image: lyricalXmdImg,
    deploymentsCount: 47,
  },
];
