import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './style.css';
import { GameManager } from './core/GameManager.js';

const game = new GameManager(document.getElementById('game'));
game.init();
if (import.meta.env.DEV) window.game = game;
